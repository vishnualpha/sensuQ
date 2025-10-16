const axios = require('axios');
const { decrypt } = require('../utils/encryption');
const logger = require('../utils/logger');

class AITestGenerator {
  constructor(config) {
    this.config = config;
    this.apiKey = config.api_key ? decrypt(config.api_key) : null;
    this.apiUrl = config.api_url || 'https://api.openai.com/v1/chat/completions';
    this.modelName = config.model_name || 'gpt-3.5-turbo';
  }

  async generateTestCases(pageData) {
    try {
      const prompt = this.buildTestGenerationPrompt(pageData);
      
      const response = await this.callLLM(prompt);
      const testCases = this.parseTestCases(response);
      
      return testCases;
    } catch (error) {
      logger.error(`Error generating test cases: ${error.message}`);
      return this.generateFallbackTestCases(pageData);
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
      return this.generateFallbackFlowTestCases(pageGroup);
    }
  }

  buildTestGenerationPrompt(pageData) {
    return `
Generate comprehensive test cases for a web page with the following details:
- URL: ${pageData.url}
- Title: ${pageData.title}
- Elements Count: ${pageData.elementsCount}

Please generate test cases that cover:
1. Functional testing (form submissions, navigation, interactions)
2. Accessibility testing (ARIA labels, keyboard navigation, color contrast)
3. Performance testing (page load times, resource loading)

Return the test cases in the following JSON format:
{
  "testCases": [
    {
      "type": "functional|accessibility|performance",
      "name": "Test case name",
      "description": "Detailed description",
      "steps": [
        {
          "action": "click|fill|select|wait|assert",
          "selector": "CSS selector",
          "value": "value if applicable",
          "description": "Step description"
        }
      ],
      "expectedResult": "Expected outcome",
      "priority": "high|medium|low"
    }
  ]
}

Generate at least 5 test cases covering different aspects of the page.
`;
  }

  buildFlowTestGenerationPrompt(pageGroup) {
    const pageDetails = pageGroup.map(page => ({
      url: page.url,
      title: page.title,
      elementsCount: page.elements_count,
      depth: page.crawl_depth
    }));

    return `
Generate comprehensive test cases for a user flow across multiple related web pages:

Pages in this flow:
${JSON.stringify(pageDetails, null, 2)}

Please generate test cases that cover:
1. **Flow-based testing**: Tests that span multiple pages in logical user journeys
2. **Functional testing**: Form submissions, navigation, interactions within each page
3. **Accessibility testing**: ARIA labels, keyboard navigation, color contrast
4. **Performance testing**: Page load times, resource loading

Focus on creating realistic user flows that connect these pages together.

Return the test cases in the following JSON format:
{
  "testCases": [
    {
      "type": "functional|accessibility|performance|flow",
      "name": "Test case name",
      "description": "Detailed description of what this test validates",
      "steps": [
        {
          "action": "navigate|click|fill|select|wait|assert|verify",
          "selector": "CSS selector",
          "value": "value if applicable",
          "description": "Step description",
          "expectedOutcome": "What should happen after this step"
        }
      ],
      "expectedResult": "Overall expected outcome of the entire test",
      "priority": "high|medium|low",
      "flowType": "single-page|multi-page"
    }
  ]
}

Generate at least 5-8 test cases with a mix of single-page and multi-page flows.
Make sure to include detailed expected results for each test case.
`;
  }

  async callLLM(prompt) {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
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
          content: prompt
        }
      ],
      max_tokens: this.config.max_tokens || 4000,
      temperature: this.config.temperature || 0.7
    };

    const response = await axios.post(this.apiUrl, payload, { 
      headers,
      timeout: 30000 // 30 second timeout
    });
    
    return response.data.choices[0].message.content;
  }

  parseTestCases(response) {
    try {
      const parsed = JSON.parse(response);
      return parsed.testCases || [];
    } catch (error) {
      logger.error('Error parsing LLM response, using fallback');
      return [];
    }
  }

  generateFallbackTestCases(pageData) {
    return [
      {
        type: 'functional',
        name: 'Page Load Test',
        description: 'Verify that the page loads successfully',
        steps: [
          {
            action: 'wait',
            selector: 'body',
            description: 'Wait for page body to load'
          },
          {
            action: 'assert',
            selector: 'title',
            description: 'Verify page title exists'
          }
        ],
        expectedResult: 'Page loads without errors and title is present',
        priority: 'high',
        executionTime: 0
      },
      {
        type: 'accessibility',
        name: 'Basic Accessibility Check',
        description: 'Check for basic accessibility features',
        steps: [
          {
            action: 'assert',
            selector: '[alt]',
            description: 'Check for alt attributes on images'
          },
          {
            action: 'assert',
            selector: 'h1, h2, h3, h4, h5, h6',
            description: 'Verify heading structure exists'
          }
        ],
        expectedResult: 'Basic accessibility features are present',
        priority: 'medium',
        executionTime: 0
      },
      {
        type: 'performance',
        name: 'Page Load Performance',
        description: 'Measure page load performance',
        steps: [
          {
            action: 'wait',
            selector: 'body',
            description: 'Measure time to load page body'
          }
        ],
        expectedResult: 'Page loads within acceptable time limits',
        priority: 'medium',
        executionTime: 0
      },
      {
        type: 'functional',
        name: 'Navigation Links Test',
        description: 'Verify navigation links are present and functional',
        steps: [
          {
            action: 'assert',
            selector: 'a[href]',
            description: 'Check for navigation links'
          }
        ],
        expectedResult: 'Navigation links are present and accessible',
        priority: 'medium',
        executionTime: 0
      },
      {
        type: 'accessibility',
        name: 'Form Labels Test',
        description: 'Check that form inputs have proper labels',
        steps: [
          {
            action: 'assert',
            selector: 'input',
            description: 'Check for form inputs'
          },
          {
            action: 'assert',
            selector: 'label',
            description: 'Check for form labels'
          }
        ],
        expectedResult: 'Form inputs have associated labels',
        priority: 'high',
        executionTime: 0
      }
    ];
  }

  generateFallbackFlowTestCases(pageGroup) {
    const testCases = [];
    
    // Generate basic test cases for each page
    pageGroup.forEach((page, index) => {
      testCases.push({
        type: 'functional',
        name: `Page Load Test - ${page.title || `Page ${index + 1}`}`,
        description: `Verify that ${page.url} loads successfully and contains expected elements`,
        steps: [
          {
            action: 'navigate',
            selector: '',
            value: page.url,
            description: 'Navigate to the page',
            expectedOutcome: 'Page loads without errors'
          },
          {
            action: 'wait',
            selector: 'body',
            description: 'Wait for page body to load',
            expectedOutcome: 'Page content is visible'
          },
          {
            action: 'assert',
            selector: 'title',
            description: 'Verify page title exists',
            expectedOutcome: 'Page title is present and not empty'
          }
        ],
        expectedResult: `Page ${page.url} loads successfully with title "${page.title}" and all basic elements are present`,
        priority: 'high',
        flowType: 'single-page'
      });
    });
    
    // Generate a flow test if multiple pages
    if (pageGroup.length > 1) {
      testCases.push({
        type: 'flow',
        name: 'Multi-Page Navigation Flow',
        description: 'Test navigation flow between related pages',
        steps: pageGroup.map((page, index) => ({
          action: 'navigate',
          selector: '',
          value: page.url,
          description: `Navigate to ${page.title || `page ${index + 1}`}`,
          expectedOutcome: `Successfully loads ${page.title || page.url}`
        })),
        expectedResult: 'User can successfully navigate through all related pages in the flow',
        priority: 'medium',
        flowType: 'multi-page'
      });
    }
    
    return testCases;
  }
}

module.exports = { AITestGenerator };