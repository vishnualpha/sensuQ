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
    const businessContext = this.config.business_context ? 
      `\n\nBUSINESS/APPLICATION CONTEXT:\n${this.config.business_context}` : '';
    
    return `
You are an expert QA engineer specializing in functional testing. Generate comprehensive, realistic test cases for this web page:

- URL: ${pageData.url}
- Title: ${pageData.title}
- Elements Count: ${pageData.elementsCount}
- Page Elements: ${JSON.stringify(pageData.elements || {}, null, 2)}${businessContext}

CRITICAL INSTRUCTIONS:
1. Use the business context above to understand the application's purpose and generate REALISTIC test scenarios
2. Focus heavily on FUNCTIONAL testing that matches real user behavior for this type of application
3. Generate test cases that exercise the core business functionality described in the context
4. Create detailed, actionable test steps with realistic test data
5. Consider edge cases and error scenarios relevant to the business domain

FUNCTIONAL TEST PRIORITIES (70% of tests should be functional):
- Form submissions with realistic business data
- Navigation through business workflows
- User interactions that drive business value
- Data entry and validation scenarios
- Search and filtering functionality
- User account operations
- Transaction and process flows

ADDITIONAL TEST TYPES (30% of tests):
- Accessibility testing (ARIA labels, keyboard navigation)
- Performance testing (page load times, critical path performance)

Return the test cases in the following JSON format:
{
  "testCases": [
    {
      "type": "functional|accessibility|performance",
      "name": "Test case name",
      "description": "Detailed description explaining business value and user scenario",
      "steps": [
        {
          "action": "click|fill|select|wait|assert",
          "selector": "CSS selector",
          "value": "realistic test data based on business context",
          "description": "Step description with expected outcome"
        }
      ],
      "expectedResult": "Detailed expected outcome with business impact",
      "priority": "high|medium|low",
      "businessValue": "Why this test is important for the business"
    }
  ]
}

Generate 8-12 test cases with at least 70% being functional tests that reflect real user scenarios for this business domain.
Use realistic test data that makes sense for the business context (e.g., real product names, realistic prices, valid email formats, etc.).
`;
  }

  buildFlowTestGenerationPrompt(pageGroup) {
    const pageDetails = pageGroup.map(page => ({
      url: page.url,
      title: page.title,
      elementsCount: page.elements_count,
      depth: page.crawl_depth,
      elements: page.elements || {}
    }));

    const businessContext = this.config.business_context ? 
      `\n\nBUSINESS/APPLICATION CONTEXT:\n${this.config.business_context}` : '';
    
    return `
You are an expert QA engineer specializing in end-to-end user journey testing. Generate comprehensive, business-focused test cases for user flows across these related pages:

Pages in this flow:
${JSON.stringify(pageDetails, null, 2)}${businessContext}

CRITICAL INSTRUCTIONS FOR FLOW-BASED TESTING:
1. Use the business context to create REALISTIC user journeys that customers would actually follow
2. Design complete end-to-end workflows that span multiple pages
3. Include realistic test data that matches the business domain
4. Focus on business-critical user paths and conversion flows
5. Test both happy path and error scenarios
6. Consider different user personas and their typical workflows

FLOW TEST PRIORITIES:
- Complete business processes (e.g., purchase flow, booking process, application submission)
- User onboarding and account management flows
- Search → Browse → Action workflows
- Multi-step forms and wizards
- Cross-page data persistence
- Authentication and authorization flows
- Error handling and recovery paths

EXAMPLE REALISTIC FLOWS BASED ON BUSINESS CONTEXT:
- E-commerce: Product search → Product details → Add to cart → Checkout → Payment → Confirmation
- Travel: Search flights → Select flight → Passenger details → Payment → Booking confirmation
- CRM: Login → Dashboard → Add customer → Fill details → Save → View customer list
- Banking: Login → Account overview → Transfer money → Confirm transfer → Transaction history

REALISTIC TEST DATA EXAMPLES:
- Use actual product names, realistic prices, valid email formats
- Include edge cases like special characters, long names, international formats
- Test with different user types (new vs returning, different roles)

Return the test cases in the following JSON format:
{
  "testCases": [
    {
      "type": "functional|accessibility|performance|flow",
      "name": "Business-focused test case name",
      "description": "Detailed description of the complete user journey and business scenario",
      "steps": [
        {
          "action": "navigate|click|fill|select|wait|assert|verify",
          "selector": "CSS selector",
          "value": "realistic business data",
          "description": "Step description with business context",
          "expectedOutcome": "What should happen after this step",
          "pageUrl": "which page this step occurs on"
        }
      ],
      "expectedResult": "Complete business outcome and user experience result",
      "priority": "high|medium|low",
      "flowType": "single-page|multi-page",
      "businessValue": "Why this flow is critical for business success",
      "userPersona": "Type of user who would follow this flow"
    }
  ]
}

Generate 6-10 comprehensive flow test cases with at least 80% being multi-page flows.
Focus on complete business processes that span multiple pages and deliver real business value.
Include realistic test data and consider different user scenarios and edge cases.
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