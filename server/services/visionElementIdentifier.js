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
