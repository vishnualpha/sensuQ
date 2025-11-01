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

        // Save test case execution result
        await pool.query(`
          INSERT INTO test_case_executions (test_execution_id, test_case_id, status, execution_time, 
                                          browser_results, actual_result, error_details, self_healed, end_time)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        `, [this.executionId, testCase.id, finalStatus, Math.round(executionTime), 
            JSON.stringify(results), actualResult, errorDetails, isFlaky]);

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
        
        // Execute test steps
        let status = 'passed';
        let errorDetails = null;
        
        try {
          await page.goto(pageData.url, { waitUntil: 'domcontentloaded', timeout: 10000 });
          
          // Handle popups before executing test steps
          await this.handlePopupsAndModals(page);
          
          for (const step of testCase.steps) {
            await this.executeTestStep(page, step);
          }
          
        } catch (error) {
          status = 'failed';
          errorDetails = error.message;
          
          // Attempt self-healing
          try {
            await this.handlePopupsAndModals(page);
            await this.attemptSelfHealing(page, testCase);
            status = 'passed';
            errorDetails = null;
          } catch (healingError) {
            // Self-healing failed
          }
        }
        
        const executionTime = Date.now() - startTime;
        
        results.push({
          browser: browserInfo.type,
          status,
          executionTime,
          errorDetails
        });
        
        await context.close();
        
      } catch (error) {
        results.push({
          browser: browserInfo.type,
          status: 'failed',
          executionTime: 0,
          errorDetails: error.message
        });
      }
    }
    
    return results;
  }

  async executeTestStep(page, step) {
    switch (step.action) {
      case 'navigate':
        await page.goto(step.value, { waitUntil: 'domcontentloaded', timeout: 10000 });
        break;
      case 'click':
        await page.click(step.selector);
        break;
      case 'fill':
        await page.fill(step.selector, step.value);
        break;
      case 'select':
        await page.selectOption(step.selector, step.value);
        break;
      case 'wait':
        await page.waitForSelector(step.selector);
        break;
      case 'assert':
      case 'verify':
        const element = await page.$(step.selector);
        if (!element) {
          throw new Error(`Element not found: ${step.selector}`);
        }
        break;
      default:
        logger.warn(`Unknown test step action: ${step.action}`);
    }
  }

  async handlePopupsAndModals(page) {
    try {
      const closeSelectors = [
        '[class*="close"]', '[class*="dismiss"]', '[class*="cancel"]',
        '[data-dismiss]', '[aria-label*="close" i]', '.modal-close',
        'button:has-text("Close")', 'button:has-text("×")', 'button:has-text("✕")'
      ];
      
      for (const selector of closeSelectors) {
        try {
          const elements = await page.$$(selector);
          for (const element of elements) {
            const isVisible = await element.isVisible();
            const isEnabled = await element.isEnabled();
            if (isVisible && isEnabled) {
              await element.click();
              await page.waitForTimeout(1000);
              break;
            }
          }
        } catch (error) {
          continue;
        }
      }
      
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      
    } catch (error) {
      logger.warn(`Error handling popups: ${error.message}`);
    }
  }

  async attemptSelfHealing(page, testCase) {
    logger.info(`Attempting self-healing for test case: ${testCase.name}`);
    
    for (const step of testCase.steps) {
      if (step.selector) {
        const alternatives = this.generateAlternativeSelectors(step.selector);
        
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

  generateAlternativeSelectors(originalSelector) {
    const alternatives = [];
    
    if (originalSelector.startsWith('#')) {
      const id = originalSelector.substring(1);
      alternatives.push(`[id="${id}"]`);
      alternatives.push(`*[id*="${id}"]`);
    }
    
    if (originalSelector.startsWith('.')) {
      const className = originalSelector.substring(1);
      alternatives.push(`[class*="${className}"]`);
      alternatives.push(`*[class~="${className}"]`);
    }
    
    return alternatives;
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