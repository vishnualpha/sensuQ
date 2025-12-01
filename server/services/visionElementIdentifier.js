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

      // Log first 500 chars of response for debugging
      logger.debug(`LLM response preview: ${response.substring(0, 500)}...`);

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
      logger.warn('Attempting fallback HTML parsing to extract basic elements');

      // Fallback: Parse HTML directly to extract basic interactive elements
      try {
        const fallbackElements = this.extractBasicElementsFromHTML(pageSource);
        logger.info(`Fallback HTML parsing found ${fallbackElements.length} basic elements`);

        return {
          screenName: this.generateScreenNameFromUrl(url),
          pageType: 'unknown',
          interactiveElements: fallbackElements,
          recommendations: [`LLM analysis failed: ${error.message}`, 'Using basic HTML parsing fallback']
        };
      } catch (fallbackError) {
        logger.error(`Fallback HTML parsing also failed: ${fallbackError.message}`);
        return {
          screenName: this.generateScreenNameFromUrl(url),
          pageType: 'unknown',
          interactiveElements: [],
          recommendations: [`LLM analysis failed: ${error.message}`, 'Fallback parsing also failed']
        };
      }
    }
  }

  /**
   * Fallback: Extract basic interactive elements from HTML when LLM fails
   */
  extractBasicElementsFromHTML(html) {
    const elements = [];
    let elementId = 0;

    // Extract links
    const linkRegex = /<a\s+([^>]*?)>(.*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const attrs = this.parseAttributes(match[1]);
      const text = match[2].replace(/<[^>]*>/g, '').trim();

      if (attrs.href) {
        elements.push({
          element_type: 'a',
          selector: this.buildSelectorFromAttributes(attrs, 'a'),
          text_content: text.substring(0, 100),
          attributes: attrs,
          interaction_priority: 'medium',
          identified_by: 'vision_llm'
        });
      }
    }

    // Extract buttons
    const buttonRegex = /<button\s+([^>]*?)>(.*?)<\/button>/gi;
    while ((match = buttonRegex.exec(html)) !== null) {
      const attrs = this.parseAttributes(match[1]);
      const text = match[2].replace(/<[^>]*>/g, '').trim();

      elements.push({
        element_type: 'button',
        selector: this.buildSelectorFromAttributes(attrs, 'button'),
        text_content: text.substring(0, 100),
        attributes: attrs,
        interaction_priority: 'medium',
        identified_by: 'vision_llm'
      });
    }

    // Extract input fields
    const inputRegex = /<input\s+([^>]*?)(?:\/?>|><\/input>)/gi;
    while ((match = inputRegex.exec(html)) !== null) {
      const attrs = this.parseAttributes(match[1]);

      elements.push({
        element_type: 'input',
        selector: this.buildSelectorFromAttributes(attrs, 'input'),
        text_content: attrs.placeholder || attrs.value || '',
        attributes: attrs,
        interaction_priority: attrs.type === 'submit' ? 'high' : 'medium',
        identified_by: 'vision_llm'
      });
    }

    logger.info(`HTML fallback extracted: ${elements.length} elements`);
    return elements;
  }

  /**
   * Parse HTML attributes from attribute string
   */
  parseAttributes(attrString) {
    const attrs = {};
    const attrRegex = /(\w+(?:-\w+)*)=["']([^"']*)["']/g;
    let match;

    while ((match = attrRegex.exec(attrString)) !== null) {
      attrs[match[1]] = match[2];
    }

    return attrs;
  }

  /**
   * Build CSS selector from attributes
   */
  buildSelectorFromAttributes(attrs, tagName) {
    if (attrs.id) return `#${attrs.id}`;
    if (attrs.name) return `${tagName}[name="${attrs.name}"]`;
    if (attrs.class) return `.${attrs.class.split(' ')[0]}`;
    return tagName;
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

    return `Find ALL interactive elements on this webpage.

URL: ${url}

=== WHAT TO FIND ===
Find these interactive elements:
- Links (including navigation menu links)
- Buttons (including modal buttons, close buttons)
- Input fields (text, email, password, etc.)
- Dropdowns/Select menus
- Checkboxes and radio buttons
- Forms (including login forms in modals/popups)
- Tabs and menu items

IMPORTANT: Look everywhere including:
✓ Navigation bars and menus
✓ Modals and popups
✓ Nested elements inside divs
✓ Login forms that appear in popups

=== HTML SOURCE (20KB max) ===
${cleanedSource}

=== INSTRUCTIONS ===

For EACH interactive element, provide:
1. What it does (brief description)
2. Text shown on it
3. Element type: Use exact HTML tag names
   - 'a' for links
   - 'button' for buttons
   - 'input' for input fields
   - 'select' for dropdowns
   - 'textarea' for text areas
4. ALL attributes (copy from HTML):
   - id
   - class
   - name
   - type (for inputs)
   - href (for links - include full URL)
   - aria-label
   - data-testid
   - role
   - placeholder
5. Priority:
   - high: Login, signup, navigation, forms
   - medium: Secondary buttons, filters
   - low: Tooltips, help icons

Also provide:
- Screen name: A short descriptive name for this page
- Page type: homepage, login, dashboard, form, or other
- Testing recommendations: 1-3 suggestions

=== OUTPUT FORMAT ===
Return ONLY this JSON (no other text):

{
  "screenName": "descriptive name for screen",
  "pageType": "homepage|login|dashboard|form|other",
  "interactiveElements": [
    {
      "description": "what this element does",
      "textContent": "visible text on element",
      "elementType": "a|button|input|select|textarea",
      "attributes": {
        "id": "element-id",
        "class": "css-classes",
        "name": "name-attr",
        "type": "input-type",
        "href": "full-url-for-links",
        "aria-label": "aria-label",
        "data-testid": "test-id",
        "role": "role-attr",
        "placeholder": "placeholder-text"
      },
      "priority": "high|medium|low"
    }
  ],
  "recommendations": ["test suggestion 1", "test suggestion 2"]
}

=== CRITICAL RULES ===
✓ Use HTML tag names (a, button, input, select)
✓ Include ALL attributes from HTML
✓ Include nested elements (menu items, modal buttons)
✓ Include complete href URLs for links
✓ DO NOT skip any interactive elements

Return ONLY valid JSON.`;
  }

  /**
   * Enhance elements with proper CSS selectors
   */
  enhanceElementsWithSelectors(elements, pageSource) {
    return elements.map(element => {
      const selector = this.buildUniqueSelector(element, pageSource);
      const text = element.textContent?.trim() || '';

      return {
        element_type: this.normalizeElementType(element.elementType),
        selector: selector,
        text_content: text,
        attributes: element.attributes || {},
        interaction_priority: element.priority || 'medium',
        identified_by: 'vision_llm',
        metadata: {
          description: element.description,
          recommendations: element.recommendations || [],
          // Store text for runtime fallback matching
          fallback_text: text.length > 0 ? text : null
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
   * Build unique selector - Use valid CSS and attribute selectors
   */
  buildUniqueSelector(element, pageSource) {
    const htmlElement = this.normalizeElementType(element.elementType);
    const attrs = element.attributes || {};
    const text = element.textContent?.trim() || '';

    // NEVER use :has-text() - it's invalid CSS selector syntax
    // Strategy: Prioritize stable, unique attributes over text

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
    if (attrs.name && ['input', 'select', 'textarea'].includes(htmlElement)) {
      if (this.isUnique(pageSource, `name="${attrs.name}"`)) {
        return `[name="${attrs.name}"]`;
      }
    }

    // Strategy 5: aria-label
    if (attrs['aria-label'] && this.isUnique(pageSource, `aria-label="${attrs['aria-label']}"`)) {
      return `[aria-label="${attrs['aria-label']}"]`;
    }

    // Strategy 6: href for links (if no text available)
    if (htmlElement === 'a' && attrs.href && attrs.href !== '#') {
      if (this.isUnique(pageSource, `href="${attrs.href}"`)) {
        return `a[href="${attrs.href}"]`;
      }
    }

    // Strategy 7: Combine element type with class (if class is not dynamic)
    if (attrs.class) {
      const classes = attrs.class.split(' ').filter(c => !this.isDynamicClass(c));
      if (classes.length > 0) {
        const classSelector = `.${classes[0]}`;
        if (this.isUnique(pageSource, `class="${classes[0]}"`)) {
          return `${htmlElement}${classSelector}`;
        }
      }
    }

    // Strategy 8: Form elements by type + name combination
    if (attrs.type && htmlElement === 'input' && attrs.name) {
      return `input[type="${attrs.type}"][name="${attrs.name}"]`;
    }

    // Strategy 9: Form elements by type alone
    if (attrs.type && htmlElement === 'input') {
      return `input[type="${attrs.type}"]`;
    }

    // Strategy 10: Role attribute
    if (attrs.role) {
      return `[role="${attrs.role}"]`;
    }

    // Strategy 11: For links, use href if available
    if (htmlElement === 'a' && attrs.href && attrs.href !== '#') {
      const hrefPath = attrs.href.split('?')[0]; // Remove query params
      return `a[href*="${hrefPath.substring(hrefPath.lastIndexOf('/') + 1)}"]`;
    }

    // Strategy 12: Generic element with first class
    if (attrs.class) {
      const firstClass = attrs.class.split(' ')[0];
      return `${htmlElement}.${firstClass}`;
    }

    // Fallback - use element type, will need runtime text matching
    logger.warn(`Using generic selector for ${htmlElement}: "${text.substring(0, 30)}" - may need text fallback at runtime`);
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
