const axios = require('axios');
const { decrypt } = require('../utils/encryption');
const logger = require('../utils/logger');

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
You are an expert QA engineer specializing in FUNCTIONAL TESTING and USER JOURNEY VALIDATION. Your primary goal is to create REALISTIC, BUSINESS-FOCUSED test cases that real users would perform.

CURRENT PAGE ANALYSIS:
- URL: ${pageData.url}
- Title: ${pageData.title}
- Interactive Elements: ${pageData.elementsCount}
- Available Forms: ${JSON.stringify(pageData.elements?.forms || [], null, 2)}
- Available Buttons: ${JSON.stringify(pageData.elements?.buttons || [], null, 2)}
- Available Inputs: ${JSON.stringify(pageData.elements?.inputs || [], null, 2)}
- Available Selects: ${JSON.stringify(pageData.elements?.selects || [], null, 2)}${businessContext}

CRITICAL REQUIREMENTS:
1. Generate ONLY FUNCTIONAL test cases that simulate real user interactions
2. Use the business context to create REALISTIC scenarios that actual users would perform
3. Focus on BUSINESS-CRITICAL workflows and user goals
4. Create detailed test steps with SPECIFIC selectors and realistic test data
5. Include CLEAR expected results and validation criteria
6. Generate scenarios that drive business value and test core functionality

FUNCTIONAL TEST FOCUS (100% of tests should be functional):
- Form submissions with domain-specific realistic data
- Search and filter operations with business-relevant queries
- User registration and login workflows
- Product/service selection and interaction flows
- Data entry and validation with real-world scenarios
- Navigation through multi-step business processes
- Transaction and conversion workflows

REALISTIC TEST DATA EXAMPLES BASED ON BUSINESS CONTEXT:
${this.generateRealisticTestDataExamples()}

EXPECTED VS ACTUAL RESULTS:
- Expected Result: What should happen when the test steps are executed successfully
- Actual Result: Will be populated during test execution with real browser results

Return ONLY functional test cases in this exact JSON format:
{
  "testCases": [
    {
      "type": "functional",
      "name": "Business-focused test case name that describes the user goal",
      "description": "Detailed description of the business scenario and user intent",
      "steps": [
        {
          "action": "navigate|click|fill|select|wait|assert|verify",
          "selector": "specific CSS selector for the element",
          "value": "realistic business-relevant test data",
          "description": "Clear description of what this step does and why"
        }
      ],
      "expectedResult": "Specific, measurable expected outcome that can be validated",
      "priority": "high|medium|low",
      "businessValue": "Clear explanation of why this test matters for business success",
      "validationCriteria": [
        "Specific criteria to validate success",
        "Measurable outcomes to check",
        "Error conditions to verify"
      ]
    }
  ]
}

Generate 6-10 FUNCTIONAL test cases that represent real user goals and business workflows.
Each test case must have clear expected results and validation criteria.
Use realistic test data that matches the business domain and user personas.
Focus on scenarios that drive business value and test critical functionality.
`;
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

    const businessContext = this.config.business_context ? 
      `\n\nBUSINESS/APPLICATION CONTEXT:\n${this.config.business_context}` : '';
    
    return `
You are an expert QA engineer specializing in END-TO-END USER JOURNEY TESTING. Your mission is to create COMPLETE, REALISTIC user workflows that span multiple pages and represent actual business processes.

DISCOVERED PAGES FOR FLOW TESTING:
${JSON.stringify(pageDetails, null, 2)}${businessContext}

CRITICAL REQUIREMENTS FOR USER JOURNEY TESTS:
1. Create COMPLETE end-to-end workflows that span multiple pages
2. Use business context to design REALISTIC user journeys that customers actually follow
3. Include specific navigation paths and data flow between pages
4. Test BUSINESS-CRITICAL conversion paths and user goals
5. Include both successful workflows and error/edge case scenarios
6. Use realistic test data that matches the business domain
7. Provide clear expected results for each step and the overall journey

USER JOURNEY PRIORITIES:
- Complete purchase/booking/application workflows
- User registration → verification → first use flows
- Search → filter → select → action workflows
- Multi-step form completion across pages
- Login → dashboard → perform task → logout flows
- Error handling and recovery scenarios
- Cross-page data validation and persistence

REALISTIC USER JOURNEY EXAMPLES:
${this.generateUserJourneyExamples()}

EXPECTED VS ACTUAL RESULTS FOR JOURNEYS:
- Expected Result: Complete description of successful journey outcome
- Actual Result: Will be populated with real execution results across all pages

Return user journey test cases in this exact JSON format:
{
  "testCases": [
    {
      "type": "flow",
      "name": "Complete user journey name (e.g., 'Complete flight booking from search to confirmation')",
      "description": "Detailed description of the end-to-end user journey and business value",
      "steps": [
        {
          "action": "navigate|click|fill|select|wait|assert|verify",
          "selector": "specific CSS selector",
          "value": "realistic test data for this business domain",
          "description": "Clear description of this step in the user journey",
          "expectedOutcome": "Specific expected result for this step",
          "pageUrl": "URL where this step should be performed"
        }
      ],
      "expectedResult": "Complete description of successful journey outcome with specific success criteria",
      "priority": "high|medium|low",
      "flowType": "single-page|multi-page",
      "businessValue": "Clear explanation of why this user journey is critical for business",
      "userPersona": "Type of user who would follow this journey",
      "validationCriteria": [
        "Specific end-to-end success criteria",
        "Data persistence validation points",
        "User experience validation points"
      ]
    }
  ]
}

Generate 4-8 comprehensive USER JOURNEY test cases that represent complete business workflows.
Focus on multi-page flows that deliver real business value and test critical user paths.
Each journey must have clear expected results and validation criteria.
Use realistic test data and consider different user personas and scenarios.
`;
  }

  async callLLM(prompt) {
    if (!this.apiKey) {
      logger.error('Cannot call LLM: API key is not set');
      throw new Error('LLM API key not configured');
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };

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

    try {
      logger.info(`Calling LLM API: ${this.apiUrl} with model ${this.modelName}`);
      const response = await axios.post(this.apiUrl, payload, {
        headers,
        timeout: 30000
      });

      return response.data.choices[0].message.content;
    } catch (error) {
      logger.error(`LLM API call failed: ${error.message}`);
      if (error.response) {
        logger.error(`Response status: ${error.response.status}`);
        logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
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

    if (pageGroup.length > 1) {
      testCases.push({
        type: 'flow',
        name: 'Complete User Journey Across Multiple Pages',
        description: 'Test complete user workflow spanning multiple discovered pages',
        steps: pageGroup.map((page, index) => ({
          action: 'navigate',
          selector: '',
          value: page.url,
          description: `Step ${index + 1}: Navigate to ${page.title || page.url} and verify content loads`,
          expectedOutcome: `Page loads successfully and displays expected content`,
          pageUrl: page.url
        })),
        expectedResult: 'User can successfully complete the entire workflow across all pages, with proper data flow and navigation',
        actualResult: null,
        priority: 'medium',
        flowType: 'multi-page',
        businessValue: 'Validates that users can complete multi-step processes across the application',
        userPersona: 'General user completing a multi-step task',
        validationCriteria: [
          'All pages in the flow load successfully',
          'Navigation between pages works correctly',
          'User can complete the intended workflow',
          'Data persists appropriately across pages'
        ]
      });
    } else {
      const page = pageGroup[0];
      testCases.push({
        type: 'functional',
        name: `Complete Page Interaction Flow - ${page.title || 'Page'}`,
        description: `Test complete user interaction flow on ${page.url}`,
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
            value: '',
            description: 'Wait for page content to load',
            expectedOutcome: 'Page content is fully visible'
          },
          {
            action: 'verify',
            selector: 'h1, h2, .title, .heading',
            value: '',
            description: 'Verify main content is present',
            expectedOutcome: 'Main heading or title is visible'
          }
        ],
        expectedResult: `User can successfully access and interact with all key elements on ${page.url}`,
        actualResult: null,
        priority: 'high',
        businessValue: 'Ensures users can effectively use the page functionality',
        validationCriteria: [
          'Page loads within acceptable time',
          'Main content is visible and accessible',
          'Key interactive elements are functional'
        ]
      });
    }

    return testCases;
  }

  generateRealisticTestDataExamples() {
    const businessContext = (this.config.business_context || '').toLowerCase();

    if (businessContext.includes('ecommerce') || businessContext.includes('shop')) {
      return `
- Product searches: "laptop", "iPhone 15", "wireless headphones", "running shoes"
- Product filters: "price under $500", "4+ star rating", "free shipping"
- User accounts: test.buyer@example.com, password: TestBuyer123
- Checkout data: John Doe, 123 Main St, New York, NY 10001, 4111111111111111
`;
    }

    if (businessContext.includes('travel') || businessContext.includes('flight') || businessContext.includes('hotel')) {
      return `
- Destinations: "New York", "Los Angeles", "Paris", "Tokyo"
- Dates: "2024-12-25" to "2024-12-30"
- Travelers: 2 adults, 1 child
- User accounts: traveler@example.com, password: Traveler123
`;
    }

    if (businessContext.includes('real estate') || businessContext.includes('property')) {
      return `
- Locations: "San Francisco", "Manhattan", "Downtown Seattle"
- Price range: "$500,000 - $1,000,000"
- Property type: "Condo", "Single Family Home", "Townhouse"
- Bedrooms: 2-3, Bathrooms: 2+
`;
    }

    if (businessContext.includes('crm') || businessContext.includes('customer')) {
      return `
- Customer names: "John Smith", "Jane Doe", "Acme Corporation"
- Contact info: john.smith@company.com, +1-555-123-4567
- Search queries: "customers in California", "deals closed this month"
- Company data: Acme Corp, 100 employees, Technology sector
`;
    }

    return `
- Generic searches: "test search query", "sample data"
- User accounts: test.user@example.com, password: Test123
- Form data: John Doe, john@example.com, +1-555-123-4567
- Dates: current date + 7 days, current date + 30 days
`;
  }

  generateUserJourneyExamples() {
    const businessContext = (this.config.business_context || '').toLowerCase();

    if (businessContext.includes('ecommerce') || businessContext.includes('shop')) {
      return `
- Browse → Search "laptop" → Filter by price → View product details → Add to cart → Checkout
- Register account → Browse categories → Add multiple items → Apply coupon → Complete purchase
- Guest checkout → Product search → Quick buy → Payment → Order confirmation
`;
    }

    if (businessContext.includes('travel')) {
      return `
- Search flights → Select dates → Choose departure/return → Review price → Add baggage → Payment
- Hotel search → Filter by amenities → Compare options → Book room → Confirmation email
- Multi-city trip → Flight + hotel bundle → Loyalty points → Complete booking
`;
    }

    return `
- Homepage → Login → Dashboard → Perform main task → View results → Logout
- Browse → Search → Filter → Select item → Action → Confirmation
- Registration → Email verification → Profile setup → First use → Success
`;
  }
}

module.exports = { AITestGenerator };