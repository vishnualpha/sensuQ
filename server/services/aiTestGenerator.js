const axios = require('axios');
const { decrypt } = require('../utils/encryption');
const logger = require('../utils/logger');
const promptLoader = require('../utils/promptLoader');
const { extractJSON } = require('../utils/jsonExtractor');

class AITestGenerator {
  constructor(config) {
    this.config = config;

    if (config.api_key) {
      this.apiKey = decrypt(config.api_key);
      if (!this.apiKey) {
        logger.error('Failed to decrypt LLM API key - decryption returned null');
      } else {
        logger.info(`LLM API key decrypted successfully (length: ${this.apiKey.length})`);
      }
    } else {
      this.apiKey = null;
      logger.warn('No LLM API key provided in config');
    }

    this.apiUrl = config.api_url || 'https://api.openai.com/v1/chat/completions';
    this.modelName = config.model_name || 'gpt-3.5-turbo';

    logger.info(`AITestGenerator initialized: provider=${config.provider}, model=${this.modelName}, apiUrl=${this.apiUrl}, hasApiKey=${!!this.apiKey}`);
  }

  async generateTestCases(pageData) {
    try {
      const prompt = this.buildTestGenerationPrompt(pageData);

      const response = await this.callLLM(prompt);
      const testCases = this.parseTestCases(response);

      return testCases;
    } catch (error) {
      logger.error(`Error generating test cases: ${error.message}`);
      return [];
    }
  }

  async generateFlowTestCases(pageGroup) {
    try {
      const prompt = this.buildFlowTestGenerationPrompt(pageGroup);

      const response = await this.callLLM(prompt);
      const testCases = this.parseTestCases(response);

      return testCases;
    } catch (error) {
      logger.error(`Error generating flow test cases: ${error.message}`);
      return [];
    }
  }

  buildTestGenerationPrompt(pageData) {
    // Extract navigation elements
    const navElements = pageData.elements?.navElements || [];
    const links = pageData.elements?.links || [];
    const navigationInfo = this.analyzeNavigationStructure(navElements, links);

    return promptLoader.renderPrompt('test-generation.txt', {
      url: pageData.url,
      title: pageData.title,
      elementsCount: pageData.elementsCount,
      forms: JSON.stringify(pageData.elements?.forms || [], null, 2),
      buttons: JSON.stringify(pageData.elements?.buttons || [], null, 2),
      inputs: JSON.stringify(pageData.elements?.inputs || [], null, 2),
      selects: JSON.stringify(pageData.elements?.selects || [], null, 2),
      navigationElements: navigationInfo.formatted,
      pageStructure: navigationInfo.structure,
      businessContext: this.config.business_context || ''
    });
  }

  analyzeNavigationStructure(navElements, links) {
    const menuItems = [];
    const sidebarItems = [];

    // Identify menu/sidebar items that likely reveal content
    links.forEach(link => {
      const text = link.text?.toLowerCase() || '';
      const selector = link.selector || '';
      const href = link.href || '';

      // Check if it's a sidebar/menu item (likely triggers content without navigation)
      const isSidebarItem =
        selector.includes('menu') ||
        selector.includes('sidebar') ||
        selector.includes('nav') ||
        href.startsWith('#') ||
        text.includes('practice') ||
        text.includes('form') ||
        text.includes('example');

      if (isSidebarItem) {
        sidebarItems.push({ text: link.text, selector });
      } else {
        menuItems.push({ text: link.text, selector });
      }
    });

    const formatted = [
      'SIDEBAR/MENU ITEMS (click these to reveal content on same page):',
      ...sidebarItems.map(item => `  - "${item.text}" (${item.selector})`),
      '',
      'REGULAR NAVIGATION LINKS (navigate to different pages):',
      ...menuItems.slice(0, 10).map(item => `  - "${item.text}" (${item.selector})`)
    ].join('\n');

    const structure = sidebarItems.length > 0
      ? `This page has a SIDEBAR NAVIGATION structure. Forms and content may be HIDDEN until you click the relevant menu item. Always check if you need to click a sidebar item first!`
      : `This page appears to be a standard page with direct content access.`;

    return { formatted, structure };
  }

  buildFlowTestGenerationPrompt(pageGroup) {
    const pageDetails = pageGroup.map(page => ({
      url: page.url,
      title: page.title,
      elementsCount: page.elements_count,
      depth: page.crawl_depth,
      elements: page.elements || {},
      forms: page.elements?.forms || [],
      buttons: page.elements?.buttons || [],
      inputs: page.elements?.inputs || []
    }));

    return promptLoader.renderPrompt('flow-test-generation.txt', {
      pageDetails: JSON.stringify(pageDetails, null, 2),
      businessContext: this.config.business_context || ''
    });
  }

  async callLLM(prompt, screenshotBase64 = null) {
    if (!this.apiKey) {
      logger.error('Cannot call LLM: API key is not set');
      throw new Error('LLM API key not configured');
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };

    let userContent;
    if (screenshotBase64) {
      userContent = [
        {
          type: 'text',
          text: prompt
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${screenshotBase64}`
          }
        }
      ];
    } else {
      userContent = prompt;
    }

    const payload = {
      model: this.modelName,
      messages: [
        {
          role: 'system',
          content: 'You are an expert QA engineer and web automation specialist. You understand modern web applications and can suggest intelligent interactions to discover content and navigate complex user interfaces.'
        },
        {
          role: 'user',
          content: userContent
        }
      ],
      max_tokens: this.config.max_tokens || 4000,
      temperature: this.config.temperature || 0.7
    };

    try {
      logger.info(`Calling LLM API: ${this.apiUrl} with model ${this.modelName}${screenshotBase64 ? ' (with screenshot)' : ''}`);
      const response = await axios.post(this.apiUrl, payload, {
        headers,
        timeout: 180000
      });

      return response.data.choices[0].message.content;
    } catch (error) {
      logger.error(`LLM API call failed: ${error.message}`);
      if (error.response) {
        logger.error(`Response status: ${error.response.status}`);
        logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
      }
      if (error.code === 'ECONNABORTED') {
        logger.error('LLM call timed out after 180 seconds');
      }
      throw error;
    }
  }

  parseTestCases(response) {
    try {
      const parsed = extractJSON(response);
      return parsed.testCases || [];
    } catch (error) {
      logger.error(`Error parsing LLM response: ${error.message}`);
      logger.error(`Response preview: ${response.substring(0, 200)}...`);
      return [];
    }
  }

}


module.exports = { AITestGenerator };
