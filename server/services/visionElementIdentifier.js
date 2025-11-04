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

  cleanHtmlForAnalysis(html) {
    let cleaned = html;
    cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
    return cleaned.substring(0, 20000);
  }

  buildVisionPrompt(url, pageSource) {
    const cleanedSource = this.cleanHtmlForAnalysis(pageSource);

    return `Analyze this webpage to identify ALL interactive elements.

URL: ${url}

TASK:
1. Find ALL interactive elements: buttons, links, inputs, forms, dropdowns, navigation menus
2. Look for nested elements (nav menus, dropdown items, modal buttons)
3. For EACH element provide:
   - Description and visible text
   - Element type (use 'a' for links, 'button', 'input', 'select', etc.)
   - ALL attributes (id, class, name, href, data-*, aria-*, role, type)
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
      "elementType": "a|button|input|select|textarea",
      "attributes": {
        "id": "element-id-if-available",
        "class": "css-classes-if-available",
        "name": "name-attribute-if-available",
        "type": "type-attribute-for-inputs",
        "href": "href-for-links",
        "aria-label": "aria-label-if-available",
        "data-testid": "test-id-if-available",
        "role": "role-if-available"
      },
      "priority": "high|medium|low"
    }
  ],
  "recommendations": ["Testing recommendations"]
}

CRITICAL:
- Use HTML tag names: 'a' for links, 'button' for buttons
- Include ALL attributes for each element
- Include NESTED elements (nav items, menu links)
- Include complete href values for links
- Each element should have unique identifying attributes`;
  }

  /**
   * Enhance elements with proper CSS selectors
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
   * Build unique selector with proper validation
   */
  buildUniqueSelector(element, pageSource) {
    const htmlElement = this.normalizeElementType(element.elementType);
    const attrs = element.attributes || {};
    const text = element.textContent?.trim() || '';

    // Strategy 1: ID (if unique)
    if (attrs.id && this.isUnique(pageSource, `id="${attrs.id}"`)) {
      return `#${attrs.id}`;
    }

    // Strategy 2: data-testid
    if (attrs['data-testid'] && this.isUnique(pageSource, `data-testid="${attrs['data-testid']}"`)) {
      return `[data-testid="${attrs['data-testid']}"]`;
    }

    // Strategy 3: Other data attributes
    for (const key of Object.keys(attrs)) {
      if (key.startsWith('data-') && key !== 'data-testid' && attrs[key]) {
        if (this.isUnique(pageSource, `${key}="${attrs[key]}"`)) {
          return `[${key}="${attrs[key]}"]`;
        }
      }
    }

    // Strategy 4: name attribute
    if (attrs.name && ['input', 'select', 'textarea', 'button'].includes(htmlElement)) {
      if (this.isUnique(pageSource, `name="${attrs.name}"`)) {
        return `[name="${attrs.name}"]`;
      }
    }

    // Strategy 5: aria-label
    if (attrs['aria-label'] && this.isUnique(pageSource, `aria-label="${attrs['aria-label']}"`)) {
      return `[aria-label="${attrs['aria-label']}"]`;
    }

    // Strategy 6: href for links
    if (htmlElement === 'a' && attrs.href && attrs.href !== '#') {
      if (this.isUnique(pageSource, `href="${attrs.href}"`)) {
        return `a[href="${attrs.href}"]`;
      }
    }

    // Strategy 7: Text content (Playwright text selector - most reliable for links)
    if (text && text.length >= 1) {
      return `${htmlElement}:has-text("${this.escapeText(text)}")`;
    }

    // Strategy 8: Combine element with attributes
    if (attrs.type && htmlElement === 'input') {
      return `input[type="${attrs.type}"]`;
    }

    if (attrs.role) {
      return `[role="${attrs.role}"]`;
    }

    // Fallback
    logger.warn(`Using generic selector for ${htmlElement}: "${text.substring(0, 30)}"`);
    return htmlElement;
  }

  /**
   * Check if attribute=value appears only once in HTML
   */
  isUnique(html, searchString) {
    const escaped = searchString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    const matches = html.match(regex);
    return matches && matches.length === 1;
  }

  /**
   * Escape text for Playwright selector
   */
  escapeText(text) {
    return text.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
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
