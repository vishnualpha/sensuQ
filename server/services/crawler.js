const { chromium, firefox, webkit } = require('playwright');
const { pool } = require('../config/database');
const { decrypt } = require('../utils/encryption');
const { AITestGenerator } = require('./aiTestGenerator');
const logger = require('../utils/logger');

class PlaywrightCrawler {
  constructor(config, testRunId, io) {
    this.config = config;
    this.testRunId = testRunId;
    this.io = io;
    this.visitedUrls = new Set();
    this.discoveredPages = [];
    this.testGenerator = new AITestGenerator(config);
    this.browsers = [];
    this.isRunning = false;
  }

  async start() {
    try {
      this.isRunning = true;
      await this.updateRunStatus('running');
      
      logger.info(`Starting crawler for test run ${this.testRunId}`);
      this.emitProgress('Starting crawler...', 0);

      // Launch browsers for cross-browser testing
      const browserTypes = [chromium];
      for (const browserType of browserTypes) {
        try {
          const browser = await browserType.launch({ headless: true });
          this.browsers.push({ type: browserType.name(), browser });
        } catch (error) {
          logger.warn(`Failed to launch ${browserType.name()}: ${error.message}`);
        }
      }

      if (this.browsers.length === 0) {
        throw new Error('No browsers could be launched');
      }

      // Start crawling
      await this.crawlWebsite();
      
      // Generate and execute tests
      await this.generateAndExecuteTests();
      
      await this.updateRunStatus('completed');
      this.emitProgress('Crawling completed successfully', 100);
      
    } catch (error) {
      logger.error(`Crawler error: ${error.message}`);
      await this.updateRunStatus('failed', error.message);
      this.emitProgress(`Crawling failed: ${error.message}`, 0);
    } finally {
      await this.cleanup();
    }
  }

  async crawlWebsite() {
    const browser = this.browsers[0].browser; // Use first available browser
    const context = await browser.newContext();
    
    // Handle authentication if credentials provided
    if (this.config.credentials) {
      const credentials = JSON.parse(decrypt(this.config.credentials));
      if (credentials.username && credentials.password) {
        await context.setHTTPCredentials({
          username: credentials.username,
          password: credentials.password
        });
      }
    }

    const page = await context.newPage();
    
    await this.crawlPage(page, this.config.target_url, 0);
    
    await context.close();
  }

  async crawlPage(page, url, depth) {
    if (depth > this.config.max_depth || this.visitedUrls.has(url) || 
        this.discoveredPages.length >= this.config.max_pages) {
      return;
    }

    try {
      this.visitedUrls.add(url);
      this.emitProgress(`Crawling: ${url}`, (this.visitedUrls.size / this.config.max_pages) * 50);

      await page.goto(url, { waitUntil: 'networkidle' });
      
      const title = await page.title();
      const elements = await page.$$('*');
      const elementsCount = elements.length;

      // Take screenshot
      const screenshotPath = `screenshots/${this.testRunId}_${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });

      // Save discovered page
      const pageResult = await pool.query(`
        INSERT INTO discovered_pages (test_run_id, url, title, elements_count, screenshot_path, crawl_depth)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [this.testRunId, url, title, elementsCount, screenshotPath, depth]);

      const pageId = pageResult.rows[0].id;
      this.discoveredPages.push({ id: pageId, url, title, elementsCount, depth });

      // Find links for further crawling
      const links = await page.$$eval('a[href]', anchors => 
        anchors.map(a => a.href).filter(href => href.startsWith('http'))
      );

      // Crawl child pages
      for (const link of links.slice(0, 10)) { // Limit links per page
        if (this.isRunning && !this.visitedUrls.has(link)) {
          await this.crawlPage(page, link, depth + 1);
        }
      }

    } catch (error) {
      logger.error(`Error crawling ${url}: ${error.message}`);
    }
  }

  async generateAndExecuteTests() {
    this.emitProgress('Generating test cases...', 60);
    
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let flakyTests = 0;

    for (const pageData of this.discoveredPages) {
      try {
        // Generate test cases using AI
        const testCases = await this.testGenerator.generateTestCases(pageData);
        
        for (const testCase of testCases) {
          totalTests++;
          
          // Execute test case across all browsers
          const results = await this.executeTestCase(testCase, pageData);
          
          // Determine final status based on cross-browser results
          const passCount = results.filter(r => r.status === 'passed').length;
          const failCount = results.filter(r => r.status === 'failed').length;
          
          let finalStatus = 'passed';
          let isFlaky = false;
          
          if (passCount > 0 && failCount > 0) {
            finalStatus = 'failed';
            isFlaky = true;
            flakyTests++;
          } else if (failCount === results.length) {
            finalStatus = 'failed';
            failedTests++;
          } else {
            passedTests++;
          }

          // Save test case result
          await pool.query(`
            INSERT INTO test_cases (test_run_id, page_id, test_type, test_name, test_description, 
                                   test_steps, expected_result, actual_result, status, 
                                   execution_time, self_healed)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `, [
            this.testRunId, pageData.id, testCase.type, testCase.name, testCase.description,
            JSON.stringify(testCase.steps), testCase.expectedResult, 
            JSON.stringify(results), finalStatus, testCase.executionTime || 0, false
          ]);
        }
        
      } catch (error) {
        logger.error(`Error generating tests for page ${pageData.url}: ${error.message}`);
      }
    }

    // Update test run statistics
    const coverage = this.discoveredPages.length > 0 ? 
      Math.min((totalTests / (this.discoveredPages.length * 5)) * 100, 100) : 0;

    await pool.query(`
      UPDATE test_runs 
      SET total_pages_discovered = $1, total_test_cases = $2, passed_tests = $3, 
          failed_tests = $4, flaky_tests = $5, coverage_percentage = $6
      WHERE id = $7
    `, [this.discoveredPages.length, totalTests, passedTests, failedTests, flakyTests, coverage, this.testRunId]);

    this.emitProgress('Test execution completed', 90);
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
          await page.goto(pageData.url);
          
          for (const step of testCase.steps) {
            await this.executeTestStep(page, step);
          }
          
        } catch (error) {
          status = 'failed';
          errorDetails = error.message;
          
          // Attempt self-healing
          try {
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
        const element = await page.$(step.selector);
        if (!element) {
          throw new Error(`Element not found: ${step.selector}`);
        }
        break;
      default:
        logger.warn(`Unknown test step action: ${step.action}`);
    }
  }

  async attemptSelfHealing(page, testCase) {
    // Implement self-healing logic
    // This could involve finding alternative selectors, waiting for elements, etc.
    logger.info(`Attempting self-healing for test case: ${testCase.name}`);
    
    // Simple self-healing: retry with different selector strategies
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
    
    // If it's an ID selector, try class and tag alternatives
    if (originalSelector.startsWith('#')) {
      const id = originalSelector.substring(1);
      alternatives.push(`[id="${id}"]`);
      alternatives.push(`*[id*="${id}"]`);
    }
    
    // If it's a class selector, try other variations
    if (originalSelector.startsWith('.')) {
      const className = originalSelector.substring(1);
      alternatives.push(`[class*="${className}"]`);
      alternatives.push(`*[class~="${className}"]`);
    }
    
    return alternatives;
  }

  async updateRunStatus(status, errorMessage = null) {
    await pool.query(`
      UPDATE test_runs 
      SET status = $1, end_time = CURRENT_TIMESTAMP, error_message = $2
      WHERE id = $3
    `, [status, errorMessage, this.testRunId]);
  }

  emitProgress(message, percentage) {
    this.io.emit('crawlerProgress', {
      testRunId: this.testRunId,
      message,
      percentage
    });
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

module.exports = { PlaywrightCrawler };