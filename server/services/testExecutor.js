const { chromium, firefox, webkit } = require('playwright');
const { pool } = require('../config/database');
const { decrypt } = require('../utils/encryption');
const logger = require('../utils/logger');
const PathNavigator = require('./pathNavigator');

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
    // Get test config with auth credentials
    const testConfigResult = await pool.query(`
      SELECT tc.credentials
      FROM test_runs tr
      JOIN test_configs tc ON tr.test_config_id = tc.id
      WHERE tr.id = $1
    `, [this.testRunId]);

    this.testConfig = {};

    if (testConfigResult.rows.length > 0 && testConfigResult.rows[0].credentials) {
      try {
        const decryptedCreds = decrypt(testConfigResult.rows[0].credentials);
        if (decryptedCreds) {
          const creds = JSON.parse(decryptedCreds);
          this.testConfig.auth_username = creds.username || creds.email;
          this.testConfig.auth_password = creds.password;
          logger.info(`Test executor loaded credentials: username=${this.testConfig.auth_username}, password=${this.testConfig.auth_password ? '***' : 'null'}`);
        }
      } catch (error) {
        logger.error(`Error decrypting credentials in test executor: ${error.message}`);
      }
    } else {
      logger.warn('No credentials found for test execution');
    }

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
            id: testCase.id,
            name: testCase.test_name,
            description: testCase.test_description,
            steps: testSteps,
            expectedResult: testCase.expected_result
          }, { url: testCase.url, title: testCase.title });
          
          // Determine final status based on cross-browser results
          const passCount = results.filter(r => r.status === 'passed').length;
          const failCount = results.filter(r => r.status === 'failed').length;
          const selfHealedAny = results.some(r => r.selfHealed);

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

          // Update isFlaky to reflect self-healing
          if (selfHealedAny) {
            isFlaky = true; // Mark as self-healed (using flaky flag for now)
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
        let selfHealed = false;

        try {
          // Pass credentials to PathNavigator for auth placeholder substitution
          const credentials = this.testConfig.auth_username ? {
            username: this.testConfig.auth_username,
            password: this.testConfig.auth_password
          } : null;
          const navigator = new PathNavigator(page, credentials);

          if (testCase.prerequisite_steps && testCase.prerequisite_steps.length > 0) {
            logger.info(`  🔧 Executing ${testCase.prerequisite_steps.length} prerequisite steps...`);
            await navigator.executeSteps(testCase.prerequisite_steps);

            screenshots.push({
              step: 'prerequisites',
              description: `Executed ${testCase.prerequisite_steps.length} prerequisite steps`,
              timestamp: new Date().toISOString(),
              data: (await page.screenshot({ fullPage: false })).toString('base64')
            });
          } else {
            await page.goto(pageData.url, { waitUntil: 'domcontentloaded', timeout: 10000 });
          }

          // Capture initial page screenshot
          const initialScreenshot = await page.screenshot({ fullPage: false });
          screenshots.push({
            step: 'initial',
            description: 'Page ready for testing',
            timestamp: new Date().toISOString(),
            data: initialScreenshot.toString('base64')
          });

          // Handle popups before executing test steps
          await this.handlePopupsAndModals(page);

          for (let i = 0; i < testCase.steps.length; i++) {
            const step = testCase.steps[i];
            const stepStartTime = Date.now();
            let stepStatus = 'passed';
            let stepError = null;

            try {
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

            } catch (stepExecutionError) {
              stepStatus = 'failed';
              stepError = stepExecutionError.message;

              // Capture error screenshot for this step
              try {
                const errorScreenshot = await page.screenshot({ fullPage: false });
                screenshots.push({
                  step: i + 1,
                  action: step.action,
                  description: `FAILED: ${step.description || step.action} - ${stepError}`,
                  timestamp: new Date().toISOString(),
                  data: errorScreenshot.toString('base64')
                });
              } catch (screenshotError) {
                logger.warn(`Failed to capture screenshot for step ${i + 1}`);
              }

              // Record step result
              await this.recordStepResult(testCase.id, i, step, stepStatus, stepError, Date.now() - stepStartTime);

              // Rethrow to fail the test
              throw stepExecutionError;
            }

            // Record successful step result
            await this.recordStepResult(testCase.id, i, step, stepStatus, null, Date.now() - stepStartTime);
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

          // Attempt self-healing
          try {
            // DO NOT call handlePopupsAndModals here - it would close modals opened by the test!
            // Self-healing should work with the current page state, including open modals
            const healingSucceeded = await this.attemptSelfHealing(page, testCase);
            if (healingSucceeded) {
              // Self-healing succeeded - mark test as passed with self_healed flag
              status = 'passed';
              selfHealed = true;
              logger.info(`Self-healing succeeded for test case: ${testCase.name}`);
            } else {
              status = 'failed';
            }
          } catch (healingError) {
            // Self-healing also failed
            logger.error(`Self-healing failed: ${healingError.message}`);
            status = 'failed';
          }
        }

        if (testCase.cleanup_steps && testCase.cleanup_steps.length > 0) {
          logger.info(`  🧹 Executing ${testCase.cleanup_steps.length} cleanup steps...`);
          try {
            // Pass credentials to cleanup navigator as well
            const credentials = this.testConfig.auth_username ? {
              username: this.testConfig.auth_username,
              password: this.testConfig.auth_password
            } : null;
            const cleanupNavigator = new PathNavigator(page, credentials);
            await cleanupNavigator.executeSteps(testCase.cleanup_steps);
            logger.info(`  ✅ Cleanup completed`);
          } catch (cleanupError) {
            logger.warn(`  ⚠️ Cleanup failed: ${cleanupError.message}`);
          }
        }

        const executionTime = Date.now() - startTime;

        results.push({
          browser: browserInfo.type,
          status,
          executionTime,
          errorDetails,
          screenshots,
          selfHealed
        });

        await context.close();

      } catch (error) {
        results.push({
          browser: browserInfo.type,
          status: 'failed',
          executionTime: 0,
          errorDetails: error.message,
          screenshots: [],
          selfHealed: false
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
          let fillValue = step.value || '';

          // Substitute auth placeholders
          if (fillValue === '{auth_username}' && this.testConfig?.auth_username) {
            fillValue = this.testConfig.auth_username;
            logger.info(`Substituting {auth_username} with configured username`);
          } else if (fillValue === '{auth_password}' && this.testConfig?.auth_password) {
            fillValue = this.testConfig.auth_password;
            logger.info(`Substituting {auth_password} with configured password`);
          }

          await this.smartFillWithRetry(page, step.selector, fillValue, timeout);
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

    // If it's an aria-label selector, also try text-based matching
    const ariaLabelMatch = selector.match(/aria-label\s*=\s*['"]([^'"]+)['"]/);
    if (ariaLabelMatch) {
      const labelText = ariaLabelMatch[1];
      alternativeSelectors.push(`text=${labelText}`);
      alternativeSelectors.push(`:has-text("${labelText}")`);
    }

    for (const sel of alternativeSelectors) {
      try {
        // Wait for element to be visible first
        await page.waitForSelector(sel, { state: 'visible', timeout: 2000 }).catch(() => {});

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

      // Try aria-label alternatives (handle both single and double quotes)
      const ariaMatch = originalSelector.match(/aria-label\s*[*~]?\s*=\s*['"]([^'"]+)['"]/);
      if (ariaMatch) {
        const ariaValue = ariaMatch[1];
        selectors.push(`[aria-label*="${ariaValue}"]`);
        selectors.push(`[aria-label="${ariaValue}"]`);
        // Also try just the tag with aria-label
        const tagMatch = originalSelector.match(/^(\w+)\[/);
        if (tagMatch) {
          selectors.push(`${tagMatch[1]}:has-text("${ariaValue}")`);
        }
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
    // Check if there's a login form visible on the page
    // If yes, DO NOT dismiss any modals (it might be a login modal!)
    try {
      const hasPasswordField = await page.locator('input[type="password"]').isVisible({ timeout: 1000 }).catch(() => false);
      if (hasPasswordField) {
        logger.info(`Skipping modal dismissal - password field detected (likely login modal)`);
        return;
      }
    } catch (error) {
      // Continue with modal dismissal
    }

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

    // DO NOT use Escape key - it might close login modals!
    // Removed: await page.keyboard.press('Escape');
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

    try {
      // Re-execute all steps with self-healing
      for (let i = 0; i < testCase.steps.length; i++) {
        const step = testCase.steps[i];
        const stepStartTime = Date.now();

        try {
          await this.executeTestStep(page, step);

          // Update step result to passed (overwrites any previous failed status)
          // Mark as self-healed since we're in the self-healing flow
          await this.recordStepResult(
            testCase.id,
            i,
            step,
            'passed',
            null,
            Date.now() - stepStartTime,
            true // self-healed
          );

          // Small delay between steps
          await page.waitForTimeout(500);
        } catch (error) {
          // Step failed even with self-healing
          logger.warn(`Self-healing failed at step ${i + 1}: ${error.message}`);

          await this.recordStepResult(
            testCase.id,
            i,
            step,
            'failed',
            error.message,
            Date.now() - stepStartTime,
            false // not self-healed
          );

          return false; // Self-healing failed
        }
      }

      // All steps passed - self-healing succeeded
      return true;
    } catch (error) {
      logger.error(`Self-healing error: ${error.message}`);
      return false;
    }
  }


  async recordStepResult(testCaseId, stepIndex, step, status, errorMessage, executionTime, selfHealed = false) {
    try {
      await pool.query(`
        INSERT INTO test_step_results (
          test_case_id, step_index, step_action, step_selector, step_value,
          step_description, status, error_message, execution_time, self_healed
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (test_case_id, step_index)
        DO UPDATE SET
          status = EXCLUDED.status,
          error_message = EXCLUDED.error_message,
          execution_time = EXCLUDED.execution_time,
          self_healed = EXCLUDED.self_healed,
          executed_at = CURRENT_TIMESTAMP
      `, [
        testCaseId,
        stepIndex,
        step.action,
        step.selector || null,
        step.value || null,
        step.description || null,
        status,
        errorMessage,
        executionTime,
        selfHealed
      ]);

      logger.info(`Step ${stepIndex + 1} for test case ${testCaseId}: ${status}${selfHealed ? ' (self-healed)' : ''}`);
    } catch (error) {
      logger.error(`Failed to record step result: ${error.message}`);
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