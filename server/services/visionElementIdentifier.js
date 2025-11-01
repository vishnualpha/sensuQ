const logger = require('../utils/logger');
const { AITestGenerator } = require('./aiTestGenerator');

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
      logger.warn('No LLM configured, falling back to DOM parsing');
      return this.fallbackDOMParsing(pageSource, url);
    }

    const prompt = this.buildVisionPrompt(url, pageSource);

    try {
      logger.info(`Analyzing page with vision LLM: ${url}`);

      const response = await this.testGenerator.callLLM(prompt, screenshotBase64);
      const analysis = JSON.parse(response);

      logger.info(`Vision LLM identified ${analysis.interactiveElements?.length || 0} interactive elements`);

      return {
        screenName: analysis.screenName || this.generateScreenNameFromUrl(url),
        pageType: analysis.pageType || 'unknown',
        interactiveElements: this.enhanceElementsWithSelectors(analysis.interactiveElements || [], pageSource),
        recommendations: analysis.recommendations || []
      };
    } catch (error) {
      logger.error(`Vision LLM analysis failed: ${error.message}`);
      return this.fallbackDOMParsing(pageSource, url);
    }
  }

  /**
   * Build prompt for vision LLM
   */
  buildVisionPrompt(url, pageSource) {
    return `You are an expert web testing analyst. Analyze this webpage screenshot and HTML source to identify ALL interactive elements that a user can interact with.

URL: ${url}

TASK:
1. Look at the screenshot and identify ALL visible interactive elements (buttons, links, inputs, dropdowns, toggles, etc.)
2. For each element, provide:
   - A clear description of what it does
   - The text/label visible on the element
   - The element type (button, link, input, select, etc.)
   - Any unique attributes that can help locate it (id, class, data attributes)
   - Priority level (high, medium, low) based on how important it is for testing
3. Determine a meaningful screen name for this page (e.g., "Login Page", "Product Listing", "Checkout - Step 1")
4. Classify the page type (login, dashboard, form, product-detail, checkout, search, profile, etc.)

HTML Source (first 5000 chars):
${pageSource.substring(0, 5000)}

RESPOND ONLY WITH VALID JSON in this exact format:
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

IMPORTANT:
- Include ALL interactive elements, not just the obvious ones
- Be thorough - modal buttons, dropdown items, form fields, navigation links, etc.
- Provide accurate text content as it appears visually
- Include enough attributes to uniquely identify each element
- Prioritize elements that are critical for user flows (high), useful for testing (medium), or minor (low)`;
  }

  /**
   * Enhance elements with proper CSS selectors
   */
  enhanceElementsWithSelectors(elements, pageSource) {
    return elements.map(element => {
      const selector = this.buildSelector(element);

      return {
        element_type: element.elementType,
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
   * Build CSS selector from element attributes
   */
  buildSelector(element) {
    const attrs = element.attributes || {};

    // Prefer ID selector
    if (attrs.id) {
      return `#${attrs.id}`;
    }

    // Try data attributes
    const dataAttr = Object.keys(attrs).find(key => key.startsWith('data-'));
    if (dataAttr) {
      return `[${dataAttr}="${attrs[dataAttr]}"]`;
    }

    // Try name attribute for inputs
    if (attrs.name && (element.elementType === 'input' || element.elementType === 'select')) {
      return `${element.elementType}[name="${attrs.name}"]`;
    }

    // Try aria-label
    if (attrs['aria-label']) {
      return `[aria-label="${attrs['aria-label']}"]`;
    }

    // Try type attribute for inputs
    if (attrs.type && element.elementType === 'input') {
      return `input[type="${attrs.type}"]`;
    }

    // Use class selector as last resort
    if (attrs.class) {
      const classes = attrs.class.split(' ').filter(c => c.length > 0);
      if (classes.length > 0) {
        return `.${classes[0]}`;
      }
    }

    // Fall back to element type with text
    if (element.textContent) {
      const text = element.textContent.replace(/'/g, "\\'").substring(0, 30);
      return `${element.elementType}:has-text("${text}")`;
    }

    // Last resort: just the element type
    return element.elementType;
  }

  /**
   * Fallback DOM parsing when LLM is not available
   */
  fallbackDOMParsing(pageSource, url) {
    logger.info('Using fallback DOM parsing for element identification');

    const elements = [];

    // Parse buttons
    const buttonMatches = pageSource.matchAll(/<button[^>]*>(.*?)<\/button>/gi);
    for (const match of buttonMatches) {
      const buttonHtml = match[0];
      const text = match[1].replace(/<[^>]*>/g, '').trim();
      const idMatch = buttonHtml.match(/id=["']([^"']+)["']/);
      const classMatch = buttonHtml.match(/class=["']([^"']+)["']/);

      elements.push({
        element_type: 'button',
        selector: idMatch ? `#${idMatch[1]}` : (classMatch ? `.${classMatch[1].split(' ')[0]}` : 'button'),
        text_content: text,
        attributes: {
          id: idMatch ? idMatch[1] : null,
          class: classMatch ? classMatch[1] : null
        },
        interaction_priority: 'medium',
        identified_by: 'dom_parser',
        metadata: {}
      });
    }

    // Parse links
    const linkMatches = pageSource.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi);
    for (const match of linkMatches) {
      const linkHtml = match[0];
      const href = match[1];
      const text = match[2].replace(/<[^>]*>/g, '').trim();
      const idMatch = linkHtml.match(/id=["']([^"']+)["']/);

      elements.push({
        element_type: 'link',
        selector: idMatch ? `#${idMatch[1]}` : `a[href="${href}"]`,
        text_content: text,
        attributes: {
          href: href,
          id: idMatch ? idMatch[1] : null
        },
        interaction_priority: 'medium',
        identified_by: 'dom_parser',
        metadata: {}
      });
    }

    // Parse inputs
    const inputMatches = pageSource.matchAll(/<input[^>]*>/gi);
    for (const match of inputMatches) {
      const inputHtml = match[0];
      const idMatch = inputHtml.match(/id=["']([^"']+)["']/);
      const nameMatch = inputHtml.match(/name=["']([^"']+)["']/);
      const typeMatch = inputHtml.match(/type=["']([^"']+)["']/);

      elements.push({
        element_type: 'input',
        selector: idMatch ? `#${idMatch[1]}` : (nameMatch ? `input[name="${nameMatch[1]}"]` : 'input'),
        text_content: '',
        attributes: {
          id: idMatch ? idMatch[1] : null,
          name: nameMatch ? nameMatch[1] : null,
          type: typeMatch ? typeMatch[1] : 'text'
        },
        interaction_priority: 'high',
        identified_by: 'dom_parser',
        metadata: {}
      });
    }

    return {
      screenName: this.generateScreenNameFromUrl(url),
      pageType: 'unknown',
      interactiveElements: elements,
      recommendations: ['Fallback DOM parsing used - consider configuring LLM for better results']
    };
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
