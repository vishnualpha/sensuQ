const logger = require('../utils/logger');
const { AITestGenerator } = require('./aiTestGenerator');
const { pool } = require('../config/database');

/**
 * Generate page-level tests for discovered pages
 */
class PageLevelTestGenerator {
  constructor(llmConfig) {
    this.config = llmConfig;
    this.testGenerator = null;

    if (llmConfig && llmConfig.api_key) {
      this.testGenerator = new AITestGenerator(llmConfig);
    }
  }

  /**
   * Generate tests for a specific page
   */
  async generateTests(testRunId, pageId, url, analysis, interactiveElements) {
    try {
      logger.info(`Generating page-level tests for: ${analysis.screenName}`);

      const tests = [];

      // 1. Basic page load test
      tests.push(await this.generatePageLoadTest(pageId, url, analysis.screenName));

      // 2. Visual regression test
      tests.push(await this.generateVisualTest(pageId, url, analysis.screenName));

      // 3. Interactive element tests
      const elementTests = await this.generateElementTests(pageId, url, analysis.screenName, interactiveElements);
      tests.push(...elementTests);

      // 4. Use LLM to generate additional meaningful tests
      if (this.testGenerator) {
        const llmTests = await this.generateLLMTests(pageId, url, analysis, interactiveElements);
        tests.push(...llmTests);
      }

      // Save all tests to database
      for (const test of tests) {
        await this.saveTestCase(testRunId, pageId, test);
      }

      logger.info(`Generated ${tests.length} page-level tests for ${analysis.screenName}`);

      return tests;

    } catch (error) {
      logger.error(`Failed to generate page-level tests: ${error.message}`);
      return [];
    }
  }

  /**
   * Generate basic page load test
   */
  async generatePageLoadTest(pageId, url, screenName) {
    return {
      test_type: 'page-load',
      test_name: `${screenName} - Page Load`,
      test_description: `Verify that ${screenName} loads successfully`,
      test_level: 'page',
      test_steps: [
        { action: 'navigate', value: url },
        { action: 'waitForLoadState', state: 'networkidle' }
      ],
      expected_result: 'Page loads without errors',
      playwright_code: this.generatePlaywrightCode('page-load', url, screenName, [])
    };
  }

  /**
   * Generate visual regression test
   */
  async generateVisualTest(pageId, url, screenName) {
    return {
      test_type: 'visual-regression',
      test_name: `${screenName} - Visual Regression`,
      test_description: `Compare visual appearance of ${screenName} against baseline`,
      test_level: 'page',
      test_steps: [
        { action: 'navigate', value: url },
        { action: 'screenshot', fullPage: true },
        { action: 'compareScreenshot', baseline: 'baseline.png' }
      ],
      expected_result: 'Visual appearance matches baseline',
      playwright_code: this.generatePlaywrightCode('visual-regression', url, screenName, [])
    };
  }

  /**
   * Generate tests for interactive elements
   */
  async generateElementTests(pageId, url, screenName, elements) {
    const tests = [];

    const highPriorityElements = elements.filter(el => el.interaction_priority === 'high');

    for (const element of highPriorityElements) {
      const test = {
        test_type: 'element-interaction',
        test_name: `${screenName} - ${element.element_type} "${element.text_content || element.selector}"`,
        test_description: `Test ${element.element_type} interaction: ${element.metadata?.description || ''}`,
        test_level: 'page',
        test_steps: [
          { action: 'navigate', value: url },
          { action: 'waitForSelector', selector: element.selector },
          { action: 'assertVisible', selector: element.selector },
          this.getInteractionStep(element)
        ],
        expected_result: `${element.element_type} interaction completes successfully`,
        playwright_code: this.generatePlaywrightCode('element-interaction', url, screenName, [element])
      };

      tests.push(test);
    }

    return tests;
  }

  /**
   * Get appropriate interaction step for element type
   */
  getInteractionStep(element) {
    switch (element.element_type) {
      case 'button':
      case 'link':
        return { action: 'click', selector: element.selector };
      case 'input':
        return { action: 'fill', selector: element.selector, value: 'test input' };
      case 'select':
        return { action: 'selectOption', selector: element.selector, value: 'first' };
      case 'checkbox':
        return { action: 'check', selector: element.selector };
      case 'radio':
        return { action: 'check', selector: element.selector };
      default:
        return { action: 'click', selector: element.selector };
    }
  }

  /**
   * Generate additional tests using LLM
   */
  async generateLLMTests(pageId, url, analysis, elements) {
    // Analyze navigation structure
    const navigationItems = elements.filter(el =>
      el.element_type === 'link' &&
      (el.metadata?.href?.startsWith('#') ||
       el.selector?.includes('menu') ||
       el.selector?.includes('nav') ||
       el.text_content?.toLowerCase().includes('practice') ||
       el.text_content?.toLowerCase().includes('form'))
    );

    const navigationContext = navigationItems.length > 0
      ? `\n\nIMPORTANT NAVIGATION CONTEXT:
This page has ${navigationItems.length} sidebar/menu items that reveal hidden content:
${navigationItems.map(item => `- "${item.text_content}" (${item.selector})`).join('\n')}

⚠️  CRITICAL: If your test interacts with form fields or content that isn't immediately visible, you MUST first click the appropriate menu item to reveal that content!

Example correct flow:
1. Click menu item (e.g., "Practice Form")
2. Wait for content to appear
3. Fill form fields
4. Submit form`
      : '';

    const prompt = `You are an expert test automation engineer. Generate meaningful test cases for this webpage.

Page: ${analysis.screenName}
URL: ${url}
Page Type: ${analysis.pageType}

Interactive Elements Currently Visible:
${elements.slice(0, 20).map(el => `- ${el.element_type}: "${el.text_content}" (${el.selector})`).join('\n')}
${navigationContext}

Generate 3-5 meaningful test cases that go beyond basic element testing. Consider:
- User workflows on this page
- Form validation (if applicable)
- Error handling scenarios
- Edge cases
- Accessibility concerns
- Performance considerations

⚠️  IMPORTANT: If you see navigation/menu items and form fields, the forms are likely HIDDEN. Include a click step for the menu item FIRST!

RESPOND ONLY WITH VALID JSON in this format:
{
  "tests": [
    {
      "testName": "Clear, descriptive test name",
      "testDescription": "What this test validates",
      "testType": "functional|validation|accessibility|performance|security",
      "steps": [
        {
          "action": "navigate|click|fill|select|check|wait|assert",
          "selector": "CSS selector if applicable",
          "value": "value if applicable",
          "description": "What this step does"
        }
      ],
      "expectedResult": "What should happen"
    }
  ]
}`;

    try {
      const response = await this.testGenerator.callLLM(prompt);

      let cleanedResponse = response.trim();
      // Remove markdown code blocks if present
      if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      }

      const llmResponse = JSON.parse(cleanedResponse);

      return llmResponse.tests.map(test => ({
        test_type: test.testType,
        test_name: `${analysis.screenName} - ${test.testName}`,
        test_description: test.testDescription,
        test_level: 'page',
        test_steps: test.steps,
        expected_result: test.expectedResult,
        playwright_code: this.generatePlaywrightCodeFromSteps(url, analysis.screenName, test.testName, test.steps)
      }));

    } catch (error) {
      logger.warn(`LLM test generation failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Generate Playwright executable code
   */
  generatePlaywrightCode(testType, url, screenName, elements) {
    const sanitizedName = screenName.replace(/[^a-zA-Z0-9]/g, '_');

    if (testType === 'page-load') {
      return `import { test, expect } from '@playwright/test';

test('${screenName} - Page Load', async ({ page }) => {
  // Navigate to page
  await page.goto('${url}');

  // Wait for page to be fully loaded
  await page.waitForLoadState('networkidle');

  // Verify page loaded successfully
  await expect(page).toHaveURL('${url}');
  const title = await page.title();
  expect(title).toBeTruthy();
});`;
    }

    if (testType === 'visual-regression') {
      return `import { test, expect } from '@playwright/test';

test('${screenName} - Visual Regression', async ({ page }) => {
  // Navigate to page
  await page.goto('${url}');

  // Wait for page to be stable
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Take screenshot and compare
  await expect(page).toHaveScreenshot('${sanitizedName}.png');
});`;
    }

    if (testType === 'element-interaction' && elements.length > 0) {
      const element = elements[0];
      let interactionCode = '';

      switch (element.element_type) {
        case 'button':
        case 'link':
          interactionCode = `await page.click('${element.selector}');`;
          break;
        case 'input':
          interactionCode = `await page.fill('${element.selector}', 'test input');`;
          break;
        case 'select':
          interactionCode = `await page.selectOption('${element.selector}', { index: 1 });`;
          break;
        case 'checkbox':
          interactionCode = `await page.check('${element.selector}');`;
          break;
        default:
          interactionCode = `await page.click('${element.selector}');`;
      }

      return `import { test, expect } from '@playwright/test';

test('${screenName} - ${element.element_type} "${element.text_content || ''}"', async ({ page }) => {
  // Navigate to page
  await page.goto('${url}');

  // Wait for element to be ready
  await page.waitForSelector('${element.selector}', { state: 'visible' });

  // Verify element is visible
  await expect(page.locator('${element.selector}')).toBeVisible();

  // Perform interaction
  ${interactionCode}
});`;
    }

    return `// Test code generation not implemented for type: ${testType}`;
  }

  /**
   * Generate Playwright code from steps
   */
  generatePlaywrightCodeFromSteps(url, screenName, testName, steps) {
    const sanitizedName = screenName.replace(/[^a-zA-Z0-9]/g, '_');

    let stepsCode = steps.map(step => {
      switch (step.action) {
        case 'navigate':
          return `  await page.goto('${step.value || url}');`;
        case 'click':
          return `  await page.click('${step.selector}');`;
        case 'fill':
          return `  await page.fill('${step.selector}', '${step.value || 'test'}');`;
        case 'select':
        case 'selectOption':
          return `  await page.selectOption('${step.selector}', '${step.value || '0'}');`;
        case 'check':
          return `  await page.check('${step.selector}');`;
        case 'wait':
        case 'waitForSelector':
          return `  await page.waitForSelector('${step.selector}', { state: 'visible' });`;
        case 'assert':
        case 'assertVisible':
          return `  await expect(page.locator('${step.selector}')).toBeVisible();`;
        default:
          return `  // ${step.action}: ${step.description || ''}`;
      }
    }).join('\n');

    return `import { test, expect } from '@playwright/test';

test('${screenName} - ${testName}', async ({ page }) => {
${stepsCode}
});`;
  }

  /**
   * Save test case to database
   */
  async saveTestCase(testRunId, pageId, test) {
    await pool.query(
      `INSERT INTO test_cases (test_run_id, page_id, test_type, test_name, test_description, test_steps, expected_result, test_level, playwright_code, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')`,
      [
        testRunId,
        pageId,
        test.test_type,
        test.test_name,
        test.test_description,
        JSON.stringify(test.test_steps),
        test.expected_result,
        test.test_level,
        test.playwright_code
      ]
    );
  }
}

module.exports = { PageLevelTestGenerator };
