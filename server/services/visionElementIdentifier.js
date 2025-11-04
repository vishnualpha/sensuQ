const logger = require('../utils/logger');
const { AITestGenerator } = require('./aiTestGenerator');
const { extractJSON } = require('../utils/jsonExtractor');

/**
 * Vision-based interactive element identifier
 * Uses LLM with vision capabilities to identify interactive elements from screenshots
 */
class VisionElementIdentifier {
  constructor(llmConfig) {
    this.config = llmConfig;
    this.testGenerator = null;

    if (llmConfig && llmConfig.api_key) {
      this.testGenerator = new AITestGenerator(llmConfig);
    }
  }

  /**
   * Identify interactive elements using vision LLM
   * @param {string} screenshotBase64 - Base64 encoded screenshot
   * @param {string} pageSource - HTML page source
   * @param {string} url - Page URL
   * @returns {Promise<Object>} - Identified elements and page metadata
   */
  async identifyInteractiveElements(screenshotBase64, pageSource, url) {
    if (!this.testGenerator || !this.config.api_key) {
      logger.error('No LLM configured - cannot identify interactive elements');
      return {
        screenName: this.generateScreenNameFromUrl(url),
        pageType: 'unknown',
        interactiveElements: [],
        recommendations: ['LLM configuration required for element identification']
      };
    }

    const prompt = this.buildVisionPrompt(url, pageSource);

    try {
      logger.info(`Analyzing page with vision LLM: ${url}`);

      const response = await this.testGenerator.callLLM(prompt, screenshotBase64);
      const analysis = extractJSON(response);

      logger.info(`Vision LLM identified ${analysis.interactiveElements?.length || 0} interactive elements`);

      return {
        screenName: analysis.screenName || this.generateScreenNameFromUrl(url),
        pageType: analysis.pageType || 'unknown',
        interactiveElements: this.enhanceElementsWithSelectors(analysis.interactiveElements || [], pageSource),
        recommendations: analysis.recommendations || []
      };
    } catch (error) {
      logger.error(`Vision LLM analysis failed: ${error.message}`);
      return {
        screenName: this.generateScreenNameFromUrl(url),
        pageType: 'unknown',
        interactiveElements: [],
        recommendations: [`LLM analysis failed: ${error.message}`]
      };
    }
  }

  /**
   * Clean HTML for analysis - keep structure but remove noise
   */
  cleanHtmlForAnalysis(html) {
    let cleaned = html;

    // Remove script and style content
    cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Remove comments
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

    // Keep only first 20000 chars
    return cleaned.substring(0, 20000);
  }

  /**
   * Build prompt for vision LLM
   */
  buildVisionPrompt(url, pageSource) {
    // Extract a more comprehensive view of the page structure
    const cleanedSource = this.cleanHtmlForAnalysis(pageSource);

    return `Analyze this webpage to identify ALL interactive elements.

URL: ${url}

TASK:
1. Find ALL interactive elements: buttons, links, inputs, forms, dropdowns, navigation menus
2. Look for nested elements (nav menus, dropdown items, modal buttons)
3. For EACH element provide:
   - Description and visible text
   - Element type (button, link, input, select, etc.)
   - Attributes (id, class, name, href, data-*)
   - Priority (high/medium/low)
4. Screen name and page type

HTML (up to 20KB):
${cleanedSource}

Return ONLY valid JSON:
{
  "screenName": "A descriptive name for this screen",
  "pageType": "page-type-classification",
  "interactiveElements": [
    {
      "description": "What this element does",
      "textContent": "Visible text on the element",
      "elementType": "button|link|input|select|checkbox|radio|toggle|etc",
      "attributes": {
        "id": "element-id-if-available",
        "class": "css-classes-if-available",
        "name": "name-attribute-if-available",
        "type": "type-attribute-for-inputs",
        "href": "href-for-links",
        "aria-label": "aria-label-if-available"
      },
      "priority": "high|medium|low"
    }
  ],
  "recommendations": [
    "Any recommendations for testing this page"
  ]
}

CRITICAL:
- Include NESTED elements (nav items, menu links, nested buttons)
- Check navigation bars, sidebars, headers, footers
- Look for elements in lists (ul, ol, li)
- Include ALL links, not just top-level ones
- Provide complete attributes for unique identification`;
  }

  /**
   * Enhance elements with proper CSS selectors
   * Validates uniqueness against actual page HTML
   */
  enhanceElementsWithSelectors(elements, pageSource) {
    return elements.map(element => {
      const selector = this.buildUniqueSelector(element, pageSource);

      return {
        element_type: this.normalizeElementType(element.elementType),
        selector: selector,
        text_content: element.textContent || '',
        attributes: element.attributes || {},
        interaction_priority: element.priority || 'medium',
        identified_by: 'vision_llm',
        metadata: {
          description: element.description,
          recommendations: element.recommendations || []
        }
      };
    });
  }

  /**
   * Normalize element types to valid HTML tags
   */
  normalizeElementType(elementType) {
    const typeMap = {
      'link': 'a',
      'textbox': 'input',
      'text': 'input',
      'dropdown': 'select',
      'checkbox': 'input',
      'radio': 'input'
    };

    const normalized = typeMap[elementType.toLowerCase()];
    return normalized || elementType.toLowerCase();
  }

  /**
   * Build unique CSS selector validated against page HTML
   */
  buildUniqueSelector(element, pageSource) {
    const htmlElement = this.normalizeElementType(element.elementType);
    const attrs = element.attributes || {};
    const text = element.textContent?.trim() || '';

    // Try different selector strategies in order of reliability
    const strategies = [
      // Strategy 1: ID (if unique)
      () => attrs.id ? `#${attrs.id}` : null,

      // Strategy 2: data attributes + element type
      () => {
        const dataAttrs = Object.keys(attrs)
          .filter(key => key.startsWith('data-'))
          .map(key => `[${key}="${this.escapeAttributeValue(attrs[key])}"]`)
          .join('');
        return dataAttrs ? `${htmlElement}${dataAttrs}` : null;
      },

      // Strategy 3: name attribute for form elements
      () => {
        if (attrs.name && ['input', 'select', 'textarea', 'button'].includes(htmlElement)) {
          return `${htmlElement}[name="${this.escapeAttributeValue(attrs.name)}"]`;
        }
        return null;
      },

      // Strategy 4: href for links (exact match)
      () => {
        if (htmlElement === 'a' && attrs.href) {
          const href = attrs.href.split('?')[0].split('#')[0];
          if (href && href !== '#' && href !== '') {
            return `a[href="${this.escapeAttributeValue(attrs.href)}"]`;
          }
        }
        return null;
      },

      // Strategy 5: type + text for buttons/links
      () => {
        if (text && text.length >= 2 && ['button', 'a'].includes(htmlElement)) {
          const escapedText = this.escapeAttributeValue(text);
          return `${htmlElement}:text("${escapedText}")`;
        }
        return null;
      },

      // Strategy 6: aria-label
      () => attrs['aria-label'] ? `[aria-label="${this.escapeAttributeValue(attrs['aria-label'])}"]` : null,

      // Strategy 7: role + text
      () => {
        if (attrs.role && text && text.length >= 2) {
          return `[role="${attrs.role}"]:text("${this.escapeAttributeValue(text)}")`;
        }
        return null;
      },

      // Strategy 8: class + text (for elements with stable classes)
      () => {
        if (attrs.class && text && text.length >= 2) {
          const stableClasses = attrs.class.split(' ')
            .filter(c => c.length > 0)
            .filter(c => !this.isDynamicClass(c))
            .slice(0, 1);

          if (stableClasses.length > 0) {
            return `${htmlElement}.${stableClasses[0]}:text("${this.escapeAttributeValue(text)}")`;
          }
        }
        return null;
      },

      // Strategy 9: element type + text (last resort)
      () => {
        if (text && text.length >= 3) {
          return `${htmlElement}:text("${this.escapeAttributeValue(text)}")`;
        }
        return null;
      }
    ];

    // Try each strategy and validate uniqueness
    for (const strategy of strategies) {
      const selector = strategy();
      if (!selector) continue;

      if (this.isSelectorUnique(selector, pageSource, htmlElement, text)) {
        logger.info(`Generated unique selector: ${selector}`);
        return selector;
      }
    }

    // Fallback: use text with element type (even if not unique)
    logger.warn(`Could not generate unique selector for ${htmlElement} "${text.substring(0, 30)}", using fallback`);
    if (text && text.length > 0) {
      return `${htmlElement}:text("${this.escapeAttributeValue(text)}")`;
    }

    return htmlElement;
  }

  /**
   * Check if a selector would be unique on the page
   * Simple heuristic using HTML string matching
   */
  isSelectorUnique(selector, pageSource, elementType, text) {
    // For ID selectors, check if ID appears only once
    if (selector.startsWith('#')) {
      const idMatch = selector.match(/#([\w-]+)/);
      if (idMatch) {
        const id = idMatch[1];
        const regex = new RegExp(`id=["']${id}["']`, 'gi');
        const matches = pageSource.match(regex);
        return matches && matches.length === 1;
      }
    }

    // For text-based selectors, count occurrences of that text in similar elements
    if (selector.includes(':text') && text) {
      const textRegex = new RegExp(`>${text}<`, 'gi');
      const matches = pageSource.match(textRegex);
      return matches && matches.length === 1;
    }

    // For href selectors
    if (selector.includes('[href=')) {
      const hrefMatch = selector.match(/\[href=["']([^"']+)["']\]/);
      if (hrefMatch) {
        const href = hrefMatch[1];
        const regex = new RegExp(`href=["']${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'gi');
        const matches = pageSource.match(regex);
        return matches && matches.length === 1;
      }
    }

    // For name selectors
    if (selector.includes('[name=')) {
      const nameMatch = selector.match(/\[name=["']([^"']+)["']\]/);
      if (nameMatch) {
        const name = nameMatch[1];
        const regex = new RegExp(`name=["']${name}["']`, 'gi');
        const matches = pageSource.match(regex);
        return matches && matches.length === 1;
      }
    }

    // Default to assuming it might be unique
    return true;
  }

  /**
   * Build robust CSS selector from element attributes
   * Combines multiple attributes for uniqueness when necessary
   * @deprecated Use buildUniqueSelector instead
   */
  buildSelector(element) {
    const attrs = element.attributes || {};
    const selectorParts = [];

    // Always start with element type for specificity
    selectorParts.push(element.elementType);

    // ID is most unique - if present, use it alone
    if (attrs.id) {
      return `#${attrs.id}`;
    }

    // Build composite selector with multiple attributes
    const attributeSelectors = [];

    // Add data attributes (very stable)
    Object.keys(attrs).forEach(key => {
      if (key.startsWith('data-') && attrs[key]) {
        attributeSelectors.push(`[${key}="${this.escapeAttributeValue(attrs[key])}"]`);
      }
    });

    // Add name attribute for inputs/forms
    if (attrs.name && (element.elementType === 'input' || element.elementType === 'select' || element.elementType === 'textarea')) {
      attributeSelectors.push(`[name="${this.escapeAttributeValue(attrs.name)}"]`);
    }

    // Add type attribute for inputs/buttons
    if (attrs.type) {
      attributeSelectors.push(`[type="${this.escapeAttributeValue(attrs.type)}"]`);
    }

    // Add aria-label (accessibility attribute, usually stable)
    if (attrs['aria-label']) {
      attributeSelectors.push(`[aria-label="${this.escapeAttributeValue(attrs['aria-label'])}"]`);
    }

    // Add role attribute
    if (attrs.role) {
      attributeSelectors.push(`[role="${this.escapeAttributeValue(attrs.role)}"]`);
    }

    // Add href for links (partial match for dynamic params)
    if (attrs.href && element.elementType === 'a') {
      const href = attrs.href.split('?')[0]; // Remove query params
      if (href && href !== '#') {
        attributeSelectors.push(`[href*="${this.escapeAttributeValue(href)}"]`);
      }
    }

    // Add stable class names (avoid dynamic ones like 'active', 'selected')
    if (attrs.class) {
      const classes = attrs.class.split(' ')
        .filter(c => c.length > 0)
        .filter(c => !this.isDynamicClass(c));

      if (classes.length > 0) {
        // Use up to 2 most stable classes
        classes.slice(0, 2).forEach(cls => {
          selectorParts.push(`.${cls}`);
        });
      }
    }

    // Combine element type with attribute selectors
    const selector = selectorParts.join('') + attributeSelectors.join('');

    // If we have a good selector, return it
    if (attributeSelectors.length > 0 || selectorParts.length > 1) {
      return selector;
    }

    // Fall back to text content if no attributes
    if (element.textContent && element.textContent.trim().length > 0) {
      const text = element.textContent.trim().substring(0, 30);
      const escapedText = this.escapeAttributeValue(text);
      return `${element.elementType}:has-text("${escapedText}")`;
    }

    // Last resort: just the element type (least specific)
    logger.warn(`Warning: Generated non-unique selector for element: ${element.elementType}`);
    return element.elementType;
  }

  /**
   * Escape attribute values for CSS selectors
   */
  escapeAttributeValue(value) {
    if (!value) return '';
    return value.replace(/"/g, '\\"').replace(/'/g, "\\'");
  }

  /**
   * Check if a class name is likely dynamic/temporary
   */
  isDynamicClass(className) {
    const dynamicPatterns = [
      'active', 'selected', 'current', 'hover', 'focus',
      'visible', 'hidden', 'open', 'closed', 'expanded',
      'collapsed', 'disabled', 'loading', 'error'
    ];

    const lowerClass = className.toLowerCase();
    return dynamicPatterns.some(pattern => lowerClass.includes(pattern));
  }

  /**
   * Generate screen name from URL
   */
  generateScreenNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;

      if (path === '/' || path === '') {
        return 'Homepage';
      }

      const segments = path.split('/').filter(s => s.length > 0);
      const lastSegment = segments[segments.length - 1];

      return lastSegment
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    } catch (error) {
      return 'Unknown Page';
    }
  }
}

module.exports = { VisionElementIdentifier };
