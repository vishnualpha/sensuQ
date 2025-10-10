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
          content: 'You are an expert QA engineer specializing in automated web testing. Generate comprehensive, realistic test cases.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: this.config.max_tokens || 4000,
      temperature: this.config.temperature || 0.7
    };

    const response = await axios.post(this.apiUrl, payload, { headers });
    
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
        priority: 'high'
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
        priority: 'medium'
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
        priority: 'medium'
      }
    ];
  }
}

module.exports = { AITestGenerator };