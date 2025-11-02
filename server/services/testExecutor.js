const { chromium, firefox, webkit } = require('playwright');
const { pool } = require('../config/database');
const { decrypt } = require('../utils/encryption');
const logger = require('../utils/logger');

class TestExecutor {
  constructor(testRunId, selectedTestCaseIds, executionId, io) {
    this.testRunId = testRunId;
    this.selectedTestCaseIds = selectedTestCaseIds || [];
    this.executionId = executionId;
    this.io = io;
    this.browsers = [];
    this.isRunning = false;
  }

  async start() {
    try {
      this.isRunning = true;
      logger.info(`Starting test execution for test run ${this.testRunId}`);
      
      this.emitProgress('Starting test execution...', 0, 'executing');

      // Launch browsers
      await this.launchBrowsers();

      if (this.browsers.length === 0) {
        throw new Error('No browsers could be launched');
      }

      // Execute selected test cases
      await this.executeSelectedTests();
      
      await this.updateExecutionStatus('completed');
      this.emitProgress('Test execution completed successfully', 100, 'completed');
      
    } catch (error) {
      logger.error(`Test execution error: ${error.message}`);
      await this.updateExecutionStatus('failed', error.message);
      this.emitProgress(`Test execution failed: ${error.message}`, 0, 'failed');
    } finally {
      await this.cleanup();
    }
  }

  async launchBrowsers() {
    const browserConfigs = [
      {
        type: chromium,
        name: 'chromium',
        options: {
          headless: false,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
          ]
        }
      }
    ];

    for (const config of browserConfigs) {
      try {
        logger.info(`Launching ${config.name} for test execution...`);
        const browser = await config.type.launch(config.options);
        this.browsers.push({ type: config.name, browser });
        logger.info(`Successfully launched ${config.name}`);
      } catch (error) {
        logger.error(`Failed to launch ${config.name}: ${error.message}`);
        
        // Try with minimal options for Chromium
        if (config.name === 'chromium') {
          try {
            logger.info('Retrying Chromium with minimal options...');
            const browser = await config.type.launch({ 
              headless: false,
              args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            this.browsers.push({ type: config.name, browser });
            logger.info('Successfully launched Chromium with minimal options');
          } catch (retryError) {
            logger.error(`Chromium retry failed: ${retryError.message}`);
          }
        }
      }
    }

    logger.info(`Successfully launched ${this.browsers.length} browser(s) for test execution`);
  }

  async executeSelectedTests() {
    // Get selected test cases or all if none specified
    let whereClause = 'tc.test_run_id = $1';
    let params = [this.testRunId];
    
    if (this.selectedTestCaseIds.length > 0) {
      whereClause += ` AND tc.id = ANY($2)`;
      params.push(this.selectedTestCaseIds);
    }
    
    const testCasesResult = await pool.query(`
      SELECT tc.*, dp.url, dp.title
      FROM test_cases tc
      LEFT JOIN discovered_pages dp ON tc.page_id = dp.id
      WHERE ${whereClause}
      ORDER BY tc.id
    `, params);
    
    const testCases = testCasesResult.rows;
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let flakyTests = 0;
    let skippedTests = 0;

    this.emitProgress(`Executing ${testCases.length} selected test cases...`, 5, 'executing');

    for (const testCase of testCases) {
      try {
        totalTests++;
        
        let finalStatus = 'passed';
        let isFlaky = false;
        let executionTime = 0;
        let results = [];
        let actualResult = '';
        let errorDetails = null;

        try {
          // Parse test steps
          const testSteps = typeof testCase.test_steps === 'string' ? 
            JSON.parse(testCase.test_steps) : testCase.test_steps || [];
          
          // Execute test case across all browsers
          results = await this.executeTestCase({
            name: testCase.test_name,
            description: testCase.test_description,
            steps: testSteps,
            expectedResult: testCase.expected_result
          }, { url: testCase.url, title: testCase.title });
          
          // Determine final status based on cross-browser results
          const passCount = results.filter(r => r.status === 'passed').length;
          const failCount = results.filter(r => r.status === 'failed').length;
          
          if (passCount > 0 && failCount > 0) {
            finalStatus = 'flaky';
            isFlaky = true;
            flakyTests++;
          } else if (failCount === results.length) {
            finalStatus = 'failed';
            failedTests++;
          } else {
            finalStatus = 'passed';
            passedTests++;
          }

          executionTime = results.reduce((sum, r) => sum + r.executionTime, 0) / results.length;
          actualResult = JSON.stringify(results);
          errorDetails = results.find(r => r.errorDetails)?.errorDetails || null;
          
        } catch (error) {
          finalStatus = 'failed';
          failedTests++;
          executionTime = 0;
          actualResult = JSON.stringify([{ browser: 'unknown', status: 'failed', executionTime: 0, errorDetails: error.message }]);
          errorDetails = error.message;
        }

        // Extract screenshots from results
        const allScreenshots = results.flatMap(r => r.screenshots || []);

        // Save test case execution result
        await pool.query(`
          INSERT INTO test_case_executions (test_execution_id, test_case_id, status, execution_time,
                                          browser_results, actual_result, error_details, self_healed, screenshots, end_time)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
        `, [this.executionId, testCase.id, finalStatus, Math.round(executionTime),
            JSON.stringify(results), actualResult, errorDetails, isFlaky, JSON.stringify(allScreenshots)]);

        // Update progress and counts in real-time
        const executionProgress = 5 + (totalTests / testCases.length) * 90;
        await pool.query(`
          UPDATE test_executions 
          SET passed_tests = $1, failed_tests = $2, flaky_tests = $3, skipped_tests = $4
          WHERE id = $5
        `, [passedTests, failedTests, flakyTests, skippedTests, this.executionId]);
        
        this.emitProgress(`Executed ${totalTests}/${testCases.length} tests (${passedTests} passed, ${failedTests} failed, ${flakyTests} flaky)`, Math.min(executionProgress, 95), 'executing');
        
      } catch (error) {
        logger.error(`Error executing test case ${testCase.id}: ${error.message}`);
        skippedTests++;
      }
    }

    // Update final execution results
    await pool.query(`
      UPDATE test_executions 
      SET passed_tests = $1, failed_tests = $2, flaky_tests = $3, skipped_tests = $4, total_test_cases = $5
      WHERE id = $6
    `, [passedTests, failedTests, flakyTests, skippedTests, totalTests, this.executionId]);

    logger.info(`Test execution completed: ${totalTests} total, ${passedTests} passed, ${failedTests} failed, ${flakyTests} flaky`);
  }

  async executeTestCase(testCase, pageData) {
    const results = [];

    for (const browserInfo of this.browsers) {
      try {
        const context = await browserInfo.browser.newContext();
        const page = await context.newPage();

        const startTime = Date.now();
        const screenshots = [];

        // Execute test steps
        let status = 'passed';
        let errorDetails = null;

        try {
          await page.goto(pageData.url, { waitUntil: 'domcontentloaded', timeout: 10000 });

          // Capture initial page screenshot
          const initialScreenshot = await page.screenshot({ fullPage: false });
          screenshots.push({
            step: 'initial',
            description: 'Page loaded',
            timestamp: new Date().toISOString(),
            data: initialScreenshot.toString('base64')
          });

          // Handle popups before executing test steps
          await this.handlePopupsAndModals(page);

          for (let i = 0; i < testCase.steps.length; i++) {
            const step = testCase.steps[i];
            await this.executeTestStep(page, step);

            // Capture screenshot after each step
            const stepScreenshot = await page.screenshot({ fullPage: false });
            screenshots.push({
              step: i + 1,
              action: step.action,
              description: step.description || `${step.action} ${step.selector || ''}`,
              timestamp: new Date().toISOString(),
              data: stepScreenshot.toString('base64')
            });

            // Small delay to let animations complete
            await page.waitForTimeout(500);
          }

        } catch (error) {
          status = 'error';
          errorDetails = error.message;

          // Capture error screenshot
          try {
            const errorScreenshot = await page.screenshot({ fullPage: false });
            screenshots.push({
              step: 'error',
              description: `Error: ${error.message}`,
              timestamp: new Date().toISOString(),
              data: errorScreenshot.toString('base64')
            });
          } catch (screenshotError) {
            logger.warn('Failed to capture error screenshot');
          }

          // Attempt self-healing (but don't change status to passed)
          try {
            await this.handlePopupsAndModals(page);
            await this.attemptSelfHealing(page, testCase);
            // Self-healing succeeded, mark as failed but note the healing
            status = 'failed';
          } catch (healingError) {
            // Self-healing also failed
            status = 'failed';
          }
        }

        const executionTime = Date.now() - startTime;

        results.push({
          browser: browserInfo.type,
          status,
          executionTime,
          errorDetails,
          screenshots
        });

        await context.close();

      } catch (error) {
        results.push({
          browser: browserInfo.type,
          status: 'failed',
          executionTime: 0,
          errorDetails: error.message,
          screenshots: []
        });
      }
    }

    return results;
  }

  async executeTestStep(page, step) {
    const timeout = 10000; // 10 second timeout for all operations

    try {
      switch (step.action) {
        case 'navigate':
          if (!step.value) {
            throw new Error(`Navigate action requires a URL value, got: ${step.value}`);
          }
          await page.goto(step.value, { waitUntil: 'domcontentloaded', timeout });
          break;
        case 'click':
          await this.smartClickWithRetry(page, step.selector, timeout);
          break;
        case 'fill':
          if (!step.value) {
            logger.warn(`Fill action has no value, using empty string for selector: ${step.selector}`);
          }
          await this.smartFillWithRetry(page, step.selector, step.value || '', timeout);
          break;
        case 'select':
          await this.smartSelectWithRetry(page, step.selector, step.value, timeout);
          break;
        case 'wait':
          await page.waitForSelector(step.selector, { timeout, state: 'visible' });
          break;
        case 'check':
        case 'uncheck':
          await this.smartClickWithRetry(page, step.selector, timeout);
          break;
        case 'assert':
        case 'verify':
          const element = await page.waitForSelector(step.selector, { timeout: 5000, state: 'attached' }).catch(() => null);
          if (!element) {
            throw new Error(`Element not found: ${step.selector}`);
          }
          break;
        default:
          logger.warn(`Unknown test step action: ${step.action}`);
      }
    } catch (error) {
      // Add more context to the error with proper field based on action
      const context = step.action === 'navigate'
        ? `URL "${step.value}"`
        : `selector "${step.selector}"`;
      throw new Error(`Failed to ${step.action} using ${context}: ${error.message}`);
    }
  }

  async smartClickWithRetry(page, selector, timeout) {
    const alternativeSelectors = await this.generateAlternativeSelectors(page, selector);

    for (const sel of alternativeSelectors) {
      try {
        // Try standard click
        await page.click(sel, { timeout: timeout / 2 });
        logger.info(`Clicked: ${sel}`);
        return;
      } catch (e) {
        // Try force click
        try {
          await page.click(sel, { force: true, timeout: timeout / 2 });
          logger.info(`Force-clicked: ${sel}`);
          return;
        } catch (e2) {
          // Try JS click
          try {
            await page.$eval(sel, el => el.click());
            logger.info(`JS-clicked: ${sel}`);
            await page.waitForTimeout(300);
            return;
          } catch (e3) {
            continue;
          }
        }
      }
    }
    throw new Error(`All click attempts failed for: ${selector}`);
  }

  async smartFillWithRetry(page, selector, value, timeout) {
    const alternativeSelectors = await this.generateAlternativeSelectors(page, selector);

    for (const sel of alternativeSelectors) {
      try {
        // Check if clicking opens a search dialog
        const initialDialogCount = await page.locator('[role="dialog"], [class*="modal"], [class*="dropdown"]').count();

        await page.click(sel, { timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);

        const newDialogCount = await page.locator('[role="dialog"], [class*="modal"], [class*="dropdown"]').count();

        if (newDialogCount > initialDialogCount) {
          // A dialog opened - try to fill the input inside it
          const dialogInput = page.locator('[role="dialog"] input, [class*="modal"] input, [class*="dropdown"] input').first();
          const hasDialogInput = await dialogInput.count();

          if (hasDialogInput > 0) {
            await dialogInput.fill(value, { timeout: 3000 });
            logger.info(`Filled search dialog: ${value}`);
            await page.waitForTimeout(1000);

            // Try to select first option
            const firstOption = page.locator('[role="option"], [class*="option"], li').first();
            const hasOption = await firstOption.count();
            if (hasOption > 0) {
              await firstOption.click({ timeout: 2000 }).catch(() => {});
              logger.info(`Selected first option from dialog`);
            }
            return;
          }
        }

        // Try standard fill
        await page.fill(sel, value, { timeout: timeout / 2 });
        logger.info(`Filled: ${sel} = ${value}`);
        return;
      } catch (e) {
        // Try type as fallback
        try {
          await page.click(sel, { timeout: 2000 });
          await page.type(sel, value, { delay: 50 });
          logger.info(`Typed: ${sel} = ${value}`);
          return;
        } catch (e2) {
          continue;
        }
      }
    }
    throw new Error(`All fill attempts failed for: ${selector}`);
  }

  async smartSelectWithRetry(page, selector, value, timeout) {
    const alternativeSelectors = await this.generateAlternativeSelectors(page, selector);

    for (const sel of alternativeSelectors) {
      try {
        // Try clicking first - might be custom select
        await page.click(sel, { timeout: 2000 });
        await page.waitForTimeout(500);

        // Check if dropdown appeared
        const options = page.locator('[role="option"], [class*="option"], li[class*="item"]');
        const optionCount = await options.count();

        if (optionCount > 0) {
          // Custom select - try to find matching option
          if (value) {
            const matchingOption = options.filter({ hasText: value }).first();
            const hasMatch = await matchingOption.count();
            if (hasMatch > 0) {
              await matchingOption.click({ timeout: 2000 });
              logger.info(`Selected custom option: ${value}`);
              return;
            }
          }
          // Click first option
          await options.first().click({ timeout: 2000 });
          logger.info(`Selected first custom option`);
          return;
        }

        // Try standard select
        if (value) {
          await page.selectOption(sel, value, { timeout: timeout / 2 });
        } else {
          await page.selectOption(sel, { index: 1 }, { timeout: timeout / 2 });
        }
        logger.info(`Selected: ${sel} = ${value}`);
        return;
      } catch (e) {
        continue;
      }
    }
    throw new Error(`All select attempts failed for: ${selector}`);
  }

  async executeWithRetry(page, selector, action) {
    const alternativeSelectors = await this.generateAlternativeSelectors(page, selector);

    for (const altSelector of alternativeSelectors) {
      try {
        await action(altSelector);
        if (altSelector !== selector) {
          logger.info(`Self-healing: Used alternative selector "${altSelector}" instead of "${selector}"`);
        }
        return; // Success
      } catch (error) {
        // Try next selector
        continue;
      }
    }

    // All selectors failed
    throw new Error(`Could not find element with selector "${selector}" or any alternatives`);
  }

  async generateAlternativeSelectors(page, originalSelector) {
    // Validate selector
    if (!originalSelector || typeof originalSelector !== 'string') {
      logger.warn(`Invalid selector provided: ${originalSelector}`);
      return [originalSelector];
    }

    const selectors = [originalSelector];

    try {
      // Extract meaningful parts from the original selector
      const idMatch = originalSelector.match(/#([\w-]+)/);
      const classMatch = originalSelector.match(/\.([\w-]+)/);
      const attrMatch = originalSelector.match(/\[([\w-]+)([=~*^$|]?=?"?([^"\]]+)"?)?\]/);

      // Try data attributes if original had them
      if (attrMatch) {
        const [, attr, , value] = attrMatch;
        if (value) {
          selectors.push(`[${attr}*="${value}"]`); // Contains match
          selectors.push(`[${attr}^="${value}"]`); // Starts with match
        }
      }

      // Try class-based alternatives
      if (classMatch) {
        const className = classMatch[1];
        selectors.push(`[class*="${className}"]`);
      }

      // Try name attribute for inputs
      if (originalSelector.includes('input') || originalSelector.includes('select')) {
        const nameMatch = originalSelector.match(/name="([^"]+)"/);
        if (nameMatch) {
          selectors.push(`[name="${nameMatch[1]}"]`);
          selectors.push(`[name*="${nameMatch[1]}"]`);
        }

        // Try placeholder-based matching
        const placeholderMatch = originalSelector.match(/placeholder[*~]?="([^"]+)"/);
        if (placeholderMatch) {
          selectors.push(`[placeholder*="${placeholderMatch[1]}"]`);
        }
      }

      // Try aria-label alternatives
      const ariaMatch = originalSelector.match(/aria-label[*~]?="([^"]+)"/);
      if (ariaMatch) {
        selectors.push(`[aria-label*="${ariaMatch[1]}"]`);
      }

    } catch (error) {
      logger.warn(`Error generating alternative selectors: ${error.message}`);
    }

    return selectors;
  }

  async handlePopupsAndModals(page) {
    try {
      logger.info('Checking for popups/modals before test execution');

      // Wait a moment for popups to appear
      await page.waitForTimeout(1500);

      // Try to dismiss modals
      await this.dismissModals(page);

      // Try to accept cookies
      await this.acceptCookies(page);

      // Try to dismiss notifications
      await this.dismissNotifications(page);

      logger.info('Completed popup/modal handling');
    } catch (error) {
      logger.warn(`Error handling popups: ${error.message}`);
    }
  }

  async dismissModals(page) {
    const closeSelectors = [
      'button:has-text("×")',
      'button:has-text("✕")',
      'button:has-text("Close")',
      '[class*="close"]',
      '[class*="dismiss"]',
      '[aria-label*="close" i]',
      '.modal-close',
      '[data-dismiss="modal"]',
      '[role="dialog"] button:has-text("Close")'
    ];

    for (const selector of closeSelectors) {
      try {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const isVisible = await element.isVisible().catch(() => false);
          if (isVisible) {
            await element.click({ timeout: 2000 }).catch(() => {});
            logger.info(`Dismissed modal using: ${selector}`);
            await page.waitForTimeout(1000);
            break;
          }
        }
      } catch (error) {
        continue;
      }
    }

    // Always try Escape key
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } catch (error) {
      // Ignore
    }
  }

  async acceptCookies(page) {
    const cookieSelectors = [
      'button:has-text("Accept All")',
      'button:has-text("Accept")',
      'button:has-text("Allow All")',
      'button:has-text("OK")',
      'button:has-text("Got it")',
      '[class*="cookie"] button:has-text("Accept")',
      '[id*="cookie-accept"]'
    ];

    for (const selector of cookieSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.isVisible().catch(() => false);
          if (isVisible) {
            await element.click({ timeout: 2000 }).catch(() => {});
            logger.info(`Accepted cookies using: ${selector}`);
            await page.waitForTimeout(1000);
            return;
          }
        }
      } catch (error) {
        continue;
      }
    }
  }

  async dismissNotifications(page) {
    const notificationSelectors = [
      'button:has-text("Not Now")',
      'button:has-text("No Thanks")',
      'button:has-text("Skip")',
      '[class*="notification"] button:has-text("Close")'
    ];

    for (const selector of notificationSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.isVisible().catch(() => false);
          if (isVisible) {
            await element.click({ timeout: 2000 }).catch(() => {});
            logger.info(`Dismissed notification using: ${selector}`);
            await page.waitForTimeout(1000);
            return;
          }
        }
      } catch (error) {
        continue;
      }
    }
  }

  async attemptSelfHealing(page, testCase) {
    logger.info(`Attempting self-healing for test case: ${testCase.name}`);

    for (const step of testCase.steps) {
      if (step.selector) {
        const alternatives = await this.generateAlternativeSelectors(page, step.selector);

        for (const altSelector of alternatives) {
          try {
            const element = await page.$(altSelector);
            if (element) {
              step.selector = altSelector;
              await this.executeTestStep(page, step);
              break;
            }
          } catch (error) {
            continue;
          }
        }
      }
    }
  }


  async updateExecutionStatus(status, errorMessage = null) {
    await pool.query(`
      UPDATE test_executions 
      SET status = $1, end_time = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [status, this.executionId]);
  }

  emitProgress(message, percentage, phase) {
    this.io.emit('testExecutionProgress', {
      testRunId: this.testRunId,
      executionId: this.executionId,
      message,
      percentage,
      phase,
      timestamp: new Date().toISOString()
    });
    
    logger.info(`Test Execution Progress [${this.testRunId}/${this.executionId}] [${phase}]: ${message} (${Math.round(percentage)}%)`);
  }

  async cleanup() {
    this.isRunning = false;
    
    for (const browserInfo of this.browsers) {
      try {
        await browserInfo.browser.close();
      } catch (error) {
        logger.error(`Error closing browser: ${error.message}`);
      }
    }
    
    this.browsers = [];
  }
}

module.exports = { TestExecutor };