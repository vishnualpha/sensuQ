const { chromium, firefox, webkit } = require('playwright');
const { pool } = require('../config/database');
const { decrypt } = require('../utils/encryption');
const { AITestGenerator } = require('./aiTestGenerator');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

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
    this.phase = 'idle'; // 'crawling', 'generating', 'ready', 'completed'
    this.shouldStopCrawling = false;
  }

  async start() {
    try {
      this.isRunning = true;
      this.phase = 'crawling';
      await this.updateRunStatus('running');
      
      logger.info(`Starting crawler for test run ${this.testRunId}`);
      this.emitProgress('Starting crawler...', 0, 'crawling');

      // Launch browsers with proper configuration
      await this.launchBrowsers();

      if (this.browsers.length === 0) {
        throw new Error('No browsers could be launched');
      }

      // Start crawling and generating tests
      await this.crawlAndGenerateTests();
      
      // Check if crawling was stopped manually
      if (this.shouldStopCrawling) {
        this.phase = 'generating';
        this.emitProgress('Crawling stopped by user. Starting flow test generation...', 50, 'generating');
      } else {
        this.phase = 'generating';
        this.emitProgress('Crawling completed. Starting flow test generation...', 50, 'generating');
      }
      
      // Generate flow tests
      await this.generateFlowTests();
      
      // Mark as ready for test execution
      await this.updateRunStatus('ready_for_execution');
      this.phase = 'ready';
      this.emitProgress('Crawling and test generation completed. Ready for test execution.', 100, 'ready');
      
    } catch (error) {
      logger.error(`Crawler error: ${error.message}`);
      await this.updateRunStatus('failed', error.message);
      this.emitProgress(`Process failed: ${error.message}`, 0, 'failed');
    } finally {
      await this.cleanup();
    }
  }

  async stopCrawlingAndGenerateTests() {
    logger.info(`Stopping crawling for test run ${this.testRunId} and proceeding to test generation`);
    this.shouldStopCrawling = true;
    
    // Don't change phase here - let the main loop handle it
    this.emitProgress('Crawling will stop after current page. Finalizing test generation...', 
      Math.min((this.discoveredPages.length / this.config.max_pages) * 40, 40), 'crawling');
    
    // The main loop will handle the transition
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
        logger.info(`Attempting to launch ${config.name}...`);
        const browser = await config.type.launch(config.options);
        this.browsers.push({ type: config.name, browser });
        logger.info(`Successfully launched ${config.name}`);
      } catch (error) {
        logger.error(`Failed to launch ${config.name}: ${error.message}`);
        logger.error(`Error stack: ${error.stack}`);
        
        // Try with minimal options for Chromium
        if (config.name === 'chromium') {
          try {
            logger.info('Retrying Chromium with minimal options...');
            const browser = await config.type.launch({ 
              headless: true,
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

    logger.info(`Successfully launched ${this.browsers.length} browser(s): ${this.browsers.map(b => b.type).join(', ')}`);
  }

  async crawlAndGenerateTests() {
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
    
    await this.crawlPageAndGenerateTests(page, this.config.target_url, 0);
    
    await context.close();
  }

  async crawlPageAndGenerateTests(page, url, depth) {
    // Check if we should stop crawling
    if (this.shouldStopCrawling) {
      logger.info('Crawling stopped by user request');
      return;
    }
    
    if (depth > this.config.max_depth || this.visitedUrls.has(url) || 
        this.discoveredPages.length >= this.config.max_pages) {
      return;
    }

    try {
      this.visitedUrls.add(url);
      const progress = Math.min((this.discoveredPages.length / this.config.max_pages) * 40, 40);
      this.emitProgress(`Crawling: ${url}`, progress);

      // Enhanced navigation with timeout and retry logic
      await this.navigateToPage(page, url);
      
      // Wait for page to stabilize
      await page.waitForTimeout(2000);
      
      // Always handle popups first - critical for continuation
      await this.handlePopupsAndModals(page);
      
      // Perform intelligent form filling and interactions
      if (this.testGenerator && this.config.api_key) {
        await this.performIntelligentInteractions(page, url);
      } else {
        // Even without LLM, perform basic form filling and interactions
        await this.performBasicFormInteractions(page, url);
      }
      
      const title = await page.title();
      
      // Get detailed page elements for better test generation
      const pageElements = await this.getDetailedPageElements(page);
      const elementsCount = pageElements.totalCount;

      // Take screenshot and save as base64 in database
      let screenshotData = null;
      let imageSize = 0;
      let imageFormat = 'png';
      let screenshotPath = null; // Keep for backward compatibility
      
      try {
        logger.info(`Taking screenshot for page: ${url}`);
        const screenshotBuffer = await page.screenshot({ 
          fullPage: true, 
          type: 'png',
          quality: 80, // Optimize file size
          timeout: 10000 // 10 second timeout
        });
        
        if (!screenshotBuffer || screenshotBuffer.length === 0) {
          throw new Error('Screenshot buffer is empty');
        }
        
        screenshotData = screenshotBuffer.toString('base64');
        imageSize = screenshotBuffer.length;
        imageFormat = 'png';
        
        logger.info(`Screenshot captured: ${imageSize} bytes, base64 length: ${screenshotData.length}`);
        
        // Also save to file system as backup (optional)
        const screenshotDir = path.join(__dirname, '../screenshots');
        if (!fs.existsSync(screenshotDir)) {
          await fs.promises.mkdir(screenshotDir, { recursive: true });
        }
        
        const screenshotFilename = `${this.testRunId}_${Date.now()}.png`;
        screenshotPath = path.join(screenshotDir, screenshotFilename);
        await fs.promises.writeFile(screenshotPath, screenshotBuffer);
        
        logger.info(`Screenshot saved to file: ${screenshotPath}`);
      } catch (screenshotError) {
        logger.error(`Failed to take screenshot for ${url}: ${screenshotError.message}`);
        logger.error(`Screenshot error stack: ${screenshotError.stack}`);
        // Continue without screenshot - don't fail the entire crawl
      }

      // Save discovered page
      logger.info(`Saving page to database: ${url}, screenshot data length: ${screenshotData ? screenshotData.length : 0}`);
      
      const pageResult = await pool.query(`
        INSERT INTO discovered_pages (test_run_id, url, title, elements_count, screenshot_path, 
                                    screenshot_data, image_size, image_format, crawl_depth)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [this.testRunId, url, title, elementsCount, screenshotPath, screenshotData, imageSize, imageFormat, depth]);

      const pageId = pageResult.rows[0].id;
      logger.info(`Page saved with ID: ${pageId}, screenshot saved: ${screenshotData ? 'YES' : 'NO'}`);
      
      const pageData = { id: pageId, url, title, elementsCount, depth };
      pageData.elements = pageElements; // Add detailed elements for test generation
      this.discoveredPages.push(pageData);

      // Generate test cases for this individual page immediately
      await this.generateTestCasesForPage(pageData);
      
      // Update counts and coverage in real-time
      const currentCoverage = Math.min((this.discoveredPages.length / this.config.max_pages) * 100, 100);
      await pool.query(`
        UPDATE test_runs 
        SET total_pages_discovered = $1, coverage_percentage = $2
        WHERE id = $3
      `, [this.discoveredPages.length, currentCoverage, this.testRunId]);

      // Emit updated progress with counts
      this.emitProgress(`Discovered ${this.discoveredPages.length} pages, generated tests`, progress, 'crawling');

      // Find navigation opportunities (links, buttons, forms)
      const navigationOpportunities = await this.findNavigationOpportunities(page);

      // Crawl child pages
      for (const opportunity of navigationOpportunities.slice(0, 8)) { // Limit opportunities per page
        if (this.isRunning && !this.visitedUrls.has(opportunity.url) && !this.shouldStopCrawling) {
          await this.crawlPageAndGenerateTests(page, opportunity.url, depth + 1);
        }
      }

    } catch (error) {
      logger.error(`Error crawling ${url}: ${error.message}`);
    }
  }

  async generateTestCasesForPage(pageData) {
    try {
      logger.info(`Generating test cases for page: ${pageData.url}`);
      
      // Generate individual page test cases
      const testCases = await this.testGenerator.generateTestCases({
        url: pageData.url,
        title: pageData.title,
        elementsCount: pageData.elementsCount
      });
      
      let generatedCount = 0;
      for (const testCase of testCases) {
        try {
          await pool.query(`
            INSERT INTO test_cases (test_run_id, page_id, test_type, test_name, test_description, 
                                   test_steps, expected_result, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
          `, [
            this.testRunId, 
            pageData.id,
            testCase.type, 
            testCase.name, 
            testCase.description,
            JSON.stringify(testCase.steps || []), 
            testCase.expectedResult
          ]);
          generatedCount++;
        } catch (error) {
          logger.error(`Error saving test case: ${error.message}`);
        }
      }
      
      // Update total test cases count
      await pool.query(`
        UPDATE test_runs 
        SET total_test_cases = (SELECT COUNT(*) FROM test_cases WHERE test_run_id = $1)
        WHERE id = $1
      `, [this.testRunId]);
      
      logger.info(`Generated ${generatedCount} test cases for page: ${pageData.url}`);
      
    } catch (error) {
      logger.error(`Error generating test cases for page ${pageData.url}: ${error.message}`);
    }
  }

  async navigateToPage(page, url) {
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        logger.info(`Navigating to page (attempt ${attempt + 1}): ${url}`);
        await page.goto(url, { 
          waitUntil: 'domcontentloaded', // Less strict than networkidle
          timeout: 15000 // Reduced timeout
        });
        
        // Wait for basic page elements
        await page.waitForTimeout(1000);
        logger.info(`Successfully navigated to: ${url}`);
        return;
        
      } catch (error) {
        attempt++;
        logger.warn(`Navigation attempt ${attempt} failed for ${url}: ${error.message}`);
        
        if (attempt >= maxRetries) {
          logger.error(`All navigation attempts failed for ${url}`);
          throw error;
        }
        
        // Wait before retry
        await page.waitForTimeout(2000);
      }
    }
  }

  async performBasicInteractions(page, url) {
    try {
      logger.info(`Performing basic interactions for ${url}`);
      
      // Handle popups and modals first
      await this.handlePopupsAndModals(page);
      
      // Look for continuation buttons
      await this.clickContinuationButtons(page);
      
      // Wait a bit for any dynamic content to load
      await page.waitForTimeout(2000);
      
    } catch (error) {
      logger.warn(`Basic interactions failed for ${url}: ${error.message}`);
    }
  }

  async performBasicFormInteractions(page, url) {
    try {
      logger.info(`Performing basic form interactions for ${url}`);
      
      // Handle popups and modals first
      await this.handlePopupsAndModals(page);
      
      // Fill forms with basic test data
      await this.fillFormsWithBasicData(page);
      
      // Look for continuation buttons
      await this.clickContinuationButtons(page);
      
      // Wait for any dynamic content to load
      await page.waitForTimeout(2000);
      
    } catch (error) {
      logger.warn(`Basic form interactions failed for ${url}: ${error.message}`);
    }
  }

  async getDetailedPageElements(page) {
    try {
      const elements = await page.evaluate(() => {
        const forms = Array.from(document.forms).map(form => ({
          action: form.action,
          method: form.method,
          inputs: Array.from(form.elements).map(el => ({
            type: el.type,
            name: el.name,
            placeholder: el.placeholder,
            required: el.required,
            id: el.id,
            className: el.className
          }))
        }));
        
        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]')).map(btn => ({
          text: btn.textContent || btn.value,
          type: btn.type,
          className: btn.className,
          id: btn.id
        }));
        
        const links = Array.from(document.querySelectorAll('a[href]')).map(link => ({
          text: link.textContent?.trim(),
          href: link.href,
          className: link.className
        }));
        
        const selects = Array.from(document.querySelectorAll('select')).map(select => ({
          name: select.name,
          id: select.id,
          options: Array.from(select.options).map(opt => ({
            text: opt.text,
            value: opt.value
          }))
        }));
        
        const inputs = Array.from(document.querySelectorAll('input')).map(input => ({
          type: input.type,
          name: input.name,
          placeholder: input.placeholder,
          id: input.id,
          required: input.required
        }));
        
        return {
          totalCount: document.querySelectorAll('*').length,
          forms,
          buttons,
          links,
          selects,
          inputs,
          hasSearch: document.querySelectorAll('input[type="search"], input[placeholder*="search" i], input[name*="search" i]').length > 0,
          hasLogin: document.querySelectorAll('input[type="password"], input[name*="password" i], input[name*="login" i]').length > 0
        };
      });
      
      return elements;
    } catch (error) {
      logger.error(`Error getting detailed page elements: ${error.message}`);
      return { totalCount: 0, forms: [], buttons: [], links: [], selects: [], inputs: [] };
    }
  }

  async fillFormsWithBasicData(page) {
    try {
      logger.info('Filling forms with basic test data...');
      
      // Get business context for realistic data
      const businessContext = this.config.business_context || '';
      const isEcommerce = businessContext.toLowerCase().includes('ecommerce') || businessContext.toLowerCase().includes('shop');
      const isTravel = businessContext.toLowerCase().includes('travel') || businessContext.toLowerCase().includes('flight') || businessContext.toLowerCase().includes('hotel');
      const isCRM = businessContext.toLowerCase().includes('crm') || businessContext.toLowerCase().includes('customer');
      
      // Fill common input types with realistic data
      const inputSelectors = [
        'input[type="text"]',
        'input[type="email"]',
        'input[type="search"]',
        'input[name*="name"]',
        'input[name*="email"]',
        'input[name*="search"]',
        'input[placeholder*="search" i]',
        'input[placeholder*="name" i]',
        'input[placeholder*="email" i]'
      ];
      
      for (const selector of inputSelectors) {
        try {
          const elements = await page.$$(selector);
          for (const element of elements) {
            const isVisible = await element.isVisible();
            const isEnabled = await element.isEnabled();
            
            if (isVisible && isEnabled) {
              const name = await element.getAttribute('name') || '';
              const placeholder = await element.getAttribute('placeholder') || '';
              const type = await element.getAttribute('type') || 'text';
              
              let testValue = '';
              
              // Generate realistic test data based on field type and business context
              if (type === 'email' || name.includes('email') || placeholder.toLowerCase().includes('email')) {
                testValue = 'test.user@example.com';
              } else if (name.includes('search') || placeholder.toLowerCase().includes('search')) {
                if (isEcommerce) {
                  testValue = 'laptop';
                } else if (isTravel) {
                  testValue = 'New York';
                } else if (isCRM) {
                  testValue = 'John Smith';
                } else {
                  testValue = 'test search';
                }
              } else if (name.includes('name') || placeholder.toLowerCase().includes('name')) {
                testValue = 'John Doe';
              } else if (name.includes('city') || placeholder.toLowerCase().includes('city')) {
                testValue = 'New York';
              } else if (name.includes('phone') || placeholder.toLowerCase().includes('phone')) {
                testValue = '+1-555-123-4567';
              } else if (name.includes('company') || placeholder.toLowerCase().includes('company')) {
                testValue = 'Test Company Inc';
              } else {
                // Default test value based on business context
                if (isEcommerce) {
                  testValue = 'electronics';
                } else if (isTravel) {
                  testValue = 'Boston';
                } else if (isCRM) {
                  testValue = 'Test Customer';
                } else {
                  testValue = 'test data';
                }
              }
              
              await element.fill(testValue);
              logger.info(`Filled ${selector} with: ${testValue}`);
              await page.waitForTimeout(500);
              
              // Only fill one field per selector to avoid overwhelming the form
              break;
            }
          }
        } catch (error) {
          continue;
        }
      }
      
      // Fill select dropdowns with first available option
      try {
        const selects = await page.$$('select');
        for (const select of selects) {
          const isVisible = await select.isVisible();
          const isEnabled = await select.isEnabled();
          
          if (isVisible && isEnabled) {
            const options = await select.$$('option');
            if (options.length > 1) {
              // Select the second option (first is usually empty/default)
              await select.selectOption({ index: 1 });
              logger.info('Selected dropdown option');
              await page.waitForTimeout(500);
            }
          }
        }
      } catch (error) {
        logger.warn(`Error filling select dropdowns: ${error.message}`);
      }
      
    } catch (error) {
      logger.warn(`Error filling forms with basic data: ${error.message}`);
    }
  }

  async handlePopupsAndModals(page) {
    try {
      logger.info('Aggressively handling popups and modals...');
      
      // Common popup/modal close selectors
      const closeSelectors = [
        // Generic close buttons
        '[class*="close"]',
        '[class*="dismiss"]',
        '[class*="cancel"]',
        '[data-dismiss]',
        '[aria-label*="close" i]',
        '[aria-label*="dismiss" i]',
        '[title*="close" i]',
        
        // Common modal close patterns
        '.modal-close',
        '.popup-close',
        '.dialog-close',
        '.overlay-close',
        '.lightbox-close',
        '.fancybox-close',
        
        // Icon-based close buttons
        '[class*="icon-close"]',
        '[class*="icon-x"]',
        '[class*="fa-times"]',
        '[class*="fa-close"]',
        '[class*="material-icons"]:has-text("close")',
        
        // Text-based close buttons
        'button:has-text("Close")',
        'button:has-text("×")',
        'button:has-text("✕")',
        'button:has-text("✖")',
        'a:has-text("Close")',
        'span:has-text("×")',
        'div:has-text("×")',
        
        // Common website-specific patterns
        '[data-testid*="close"]',
        '[data-cy*="close"]',
        '[id*="close"]',
        '[class*="btn-close"]',
        
        // Overlay and backdrop clicks
        '.modal-backdrop',
        '.overlay-backdrop',
        '[class*="backdrop"]'
      ];
      
      // Try to close any visible popups/modals - be more aggressive
      for (const selector of closeSelectors) {
        try {
          const elements = await page.$$(selector);
          for (const element of elements) {
            const isVisible = await element.isVisible();
            const isEnabled = await element.isEnabled();
            if (isVisible && isEnabled) {
              await element.click();
              logger.info(`Closed popup/modal using selector: ${selector}`);
              await page.waitForTimeout(1500); // Wait longer for animation
              break; // Only close one at a time
            }
          }
        } catch (error) {
          // Continue to next selector if this one fails
          continue;
        }
      }
      
      // Try pressing Escape key as fallback
      try {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        logger.info('Pressed Escape key to dismiss modals');
      } catch (error) {
        // Ignore escape key errors
      }
      
      // Handle cookie consent banners
      await this.handleCookieConsent(page);
      
      // Handle notification permission requests
      await this.handleNotificationRequests(page);
      
    } catch (error) {
      logger.warn(`Error handling popups and modals: ${error.message}`);
    }
  }

  async handleCookieConsent(page) {
    try {
      const cookieSelectors = [
        'button:has-text("Accept")',
        'button:has-text("Accept All")',
        'button:has-text("I Accept")',
        'button:has-text("OK")',
        'button:has-text("Got it")',
        'button:has-text("Continue")',
        '[class*="cookie"] button',
        '[class*="consent"] button',
        '[id*="cookie"] button',
        '[data-testid*="cookie"] button'
      ];
      
      for (const selector of cookieSelectors) {
        try {
          const element = await page.$(selector);
          if (element && await element.isVisible()) {
            await element.click();
            logger.info(`Accepted cookies using selector: ${selector}`);
            await page.waitForTimeout(1000);
            break;
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      logger.warn(`Error handling cookie consent: ${error.message}`);
    }
  }

  async handleNotificationRequests(page) {
    try {
      const notificationSelectors = [
        'button:has-text("Not Now")',
        'button:has-text("Maybe Later")',
        'button:has-text("No Thanks")',
        'button:has-text("Skip")',
        '[class*="notification"] button:has-text("Close")',
        '[class*="notification"] button:has-text("×")'
      ];
      
      for (const selector of notificationSelectors) {
        try {
          const element = await page.$(selector);
          if (element && await element.isVisible()) {
            await element.click();
            logger.info(`Dismissed notification using selector: ${selector}`);
            await page.waitForTimeout(1000);
            break;
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      logger.warn(`Error handling notification requests: ${error.message}`);
    }
  }

  async clickContinuationButtons(page) {
    try {
      logger.info('Looking for continuation buttons...');
      
      const continuationSelectors = [
        // Generic continuation buttons
        'button:has-text("Continue")',
        'button:has-text("Next")',
        'button:has-text("Proceed")',
        'button:has-text("Get Started")',
        'button:has-text("Start")',
        'button:has-text("Begin")',
        'button:has-text("Explore")',
        'button:has-text("View More")',
        'button:has-text("Load More")',
        'button:has-text("Show More")',
        
        // Link-style continuations
        'a:has-text("Continue")',
        'a:has-text("Next")',
        'a:has-text("Explore")',
        'a:has-text("View All")',
        'a:has-text("See More")',
        
        // Common class-based patterns
        '[class*="continue"]',
        '[class*="next"]',
        '[class*="proceed"]',
        '[class*="cta"]', // Call to action
        '[class*="primary-btn"]',
        
        // Data attribute patterns
        '[data-testid*="continue"]',
        '[data-testid*="next"]',
        '[data-cy*="continue"]'
      ];
      
      for (const selector of continuationSelectors) {
        try {
          const elements = await page.$$(selector);
          for (const element of elements) {
            const isVisible = await element.isVisible();
            const isEnabled = await element.isEnabled();
            
            if (isVisible && isEnabled) {
              // Check if clicking this might navigate to a new page
              const href = await element.getAttribute('href');
              const onclick = await element.getAttribute('onclick');
              
              if (href || onclick || await element.evaluate(el => el.tagName === 'BUTTON')) {
                await element.click();
                logger.info(`Clicked continuation button: ${selector}`);
                await page.waitForTimeout(2000); // Wait for potential navigation
                return; // Only click one continuation button per page
              }
            }
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      logger.warn(`Error clicking continuation buttons: ${error.message}`);
    }
  }

  async performIntelligentInteractions(page, url) {
    try {
      // First, handle any popups or modals that might block navigation
      await this.handlePopupsAndModals(page);
      
      // Get page context for LLM
      const pageContext = await this.getPageContext(page);
      
      // Ask LLM for intelligent interaction suggestions based on business context
      const interactions = await this.getInteractionSuggestions(pageContext, url);
      
      // Execute suggested interactions
      for (const interaction of interactions) {
        try {
          await this.executeInteraction(page, interaction);
          await page.waitForTimeout(1500); // Wait longer between interactions
        } catch (error) {
          logger.warn(`Failed to execute interaction: ${error.message}`);
        }
      }
      
      // After intelligent interactions, also try basic form filling as fallback
      await this.fillFormsWithBasicData(page);
      
    } catch (error) {
      logger.warn(`Intelligent interactions failed for ${url}: ${error.message}`);
      // Fallback to basic form interactions
      await this.performBasicFormInteractions(page, url);
    }
  }

  async getPageContext(page) {
    try {
      const context = await page.evaluate(() => {
        const forms = Array.from(document.forms).map(form => ({
          action: form.action,
          method: form.method,
          inputs: Array.from(form.elements).map(el => ({
            type: el.type,
            name: el.name,
            placeholder: el.placeholder,
            required: el.required
          }))
        }));
        
        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]')).map(btn => ({
          text: btn.textContent || btn.value,
          type: btn.type,
          className: btn.className
        }));
        
        const selects = Array.from(document.querySelectorAll('select')).map(select => ({
          name: select.name,
          options: Array.from(select.options).map(opt => opt.text)
        }));
        
        const modals = Array.from(document.querySelectorAll('[class*="modal"], [class*="popup"], [class*="dialog"]')).length > 0;
        
        return {
          title: document.title,
          url: window.location.href,
          forms,
          buttons,
          selects,
          hasModals: modals,
          bodyText: document.body.innerText.substring(0, 1000) // First 1000 chars
        };
      });
      
      return context;
    } catch (error) {
      logger.error(`Error getting page context: ${error.message}`);
      return null;
    }
  }

  async getInteractionSuggestions(pageContext, url) {
    if (!pageContext || !this.testGenerator) return [];
    
    try {
      const businessContext = this.config.business_context ? 
        `\n\nBUSINESS/APPLICATION CONTEXT:\n${this.config.business_context}` : '';
      
      const prompt = `
You are an expert web crawler specializing in discovering hidden content through intelligent form interactions. 
Analyze this web page and suggest realistic interactions that will reveal more application functionality:

URL: ${url}
Title: ${pageContext.title}${businessContext}

CURRENT PAGE ELEMENTS:
- Forms: ${JSON.stringify(pageContext.forms, null, 2)}
- Buttons: ${JSON.stringify(pageContext.buttons, null, 2)}
- Dropdowns: ${JSON.stringify(pageContext.selects, null, 2)}
- Has Modals: ${pageContext.hasModals}
- Has Search: ${pageContext.hasSearch}
- Has Login: ${pageContext.hasLogin}

Page Content Preview: ${pageContext.bodyText}

CRITICAL INSTRUCTIONS:
1. Use the business context to understand what type of application this is
2. Suggest interactions that real users would perform to access core functionality
3. Focus on form submissions that reveal new pages/content (search forms, filters, etc.)
4. Use realistic test data that matches the business domain
5. Prioritize interactions that lead to business-critical workflows

INTERACTION PRIORITIES:
- Search forms (product search, flight search, customer search, etc.)
- Filter and category selections
- Login forms (if present)
- Navigation forms that reveal content
- Multi-step wizards and processes

REALISTIC TEST DATA EXAMPLES:
- E-commerce: "laptop", "iPhone", "electronics"
- Travel: "New York", "Los Angeles", "2024-12-25"
- CRM: "John Smith", "test@company.com", "555-1234"
- Real Estate: "San Francisco", "$500000", "2 bedroom"
- Job Portal: "Software Engineer", "San Francisco", "Full-time"

Return as JSON array:
[
  {
    "type": "fill|click|select|submit|dismiss",
    "selector": "CSS selector",
    "value": "realistic business-relevant test data",
    "description": "What this interaction does and why it's valuable for discovery",
    "expectedOutcome": "What new content or functionality this should reveal"
  }
]

Suggest 3-5 intelligent interactions that will maximize content discovery.
Focus on interactions that reveal hidden functionality and business-critical workflows.
Use realistic test data that makes sense for the business context.
`;

      const response = await this.testGenerator.callLLM(prompt);
      const suggestions = JSON.parse(response);
      
      return Array.isArray(suggestions) ? suggestions.slice(0, 5) : [];
      
    } catch (error) {
      logger.warn(`Failed to get interaction suggestions: ${error.message}`);
      return [];
    }
  }

  async executeInteraction(page, interaction) {
    switch (interaction.type) {
      case 'fill':
        await page.fill(interaction.selector, interaction.value);
        logger.info(`Filled ${interaction.selector} with: ${interaction.value}`);
        break;
        
      case 'click':
        await page.click(interaction.selector);
        logger.info(`Clicked: ${interaction.selector}`);
        break;
        
      case 'select':
        await page.selectOption(interaction.selector, interaction.value);
        logger.info(`Selected ${interaction.value} in: ${interaction.selector}`);
        break;
        
      case 'submit':
        // Fill the form first, then submit
        if (interaction.value) {
          const formInputs = await page.$$(`${interaction.selector} input, ${interaction.selector} select`);
          for (const input of formInputs) {
            const type = await input.getAttribute('type');
            if (type !== 'submit' && type !== 'button') {
              try {
                await input.fill(interaction.value);
                break; // Fill only the first suitable input
              } catch (e) {
                continue;
              }
            }
          }
        }
        
        // Submit the form
        const submitButton = await page.$(`${interaction.selector} input[type="submit"], ${interaction.selector} button[type="submit"], ${interaction.selector} button`);
        if (submitButton) {
          await submitButton.click();
          logger.info(`Submitted form: ${interaction.selector}`);
          // Wait longer for form submission results
          await page.waitForTimeout(3000);
        }
        break;
        
      case 'dismiss':
        // Try common modal dismiss patterns
        const dismissSelectors = [
          interaction.selector,
          '[class*="close"]',
          '[class*="dismiss"]',
          '.modal-close',
          '[aria-label="Close"]'
        ];
        
        for (const selector of dismissSelectors) {
          try {
            await page.click(selector);
            logger.info(`Dismissed modal using: ${selector}`);
            break;
          } catch (e) {
            continue;
          }
        }
        break;
        
      default:
        logger.warn(`Unknown interaction type: ${interaction.type}`);
    }
  }

  async findNavigationOpportunities(page) {
    try {
      const opportunities = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href]'))
          .map(a => ({ url: a.href, text: a.textContent?.trim(), type: 'link' }))
          .filter(link => link.url.startsWith('http') && link.text);
        
        // Look for navigation buttons that might change the URL
        const navButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
          .filter(btn => {
            const text = btn.textContent?.toLowerCase() || '';
            return text.includes('next') || text.includes('more') || text.includes('view') || 
                   text.includes('explore') || text.includes('continue');
          })
          .map(btn => ({ 
            url: window.location.href + '#interaction', 
            text: btn.textContent?.trim(), 
            type: 'button',
            selector: btn.tagName + (btn.className ? '.' + btn.className.split(' ').join('.') : '')
          }));
        
        return [...links, ...navButtons];
      });
      
      // Remove duplicates and limit results
      const uniqueOpportunities = opportunities
        .filter((opp, index, self) => 
          index === self.findIndex(o => o.url === opp.url)
        )
        .slice(0, 10);
      
      return uniqueOpportunities;
      
    } catch (error) {
      logger.error(`Error finding navigation opportunities: ${error.message}`);
      return [];
    }
  }

  async generateFlowTests() {
    this.phase = 'generating';
    this.emitProgress('Generating flow-based test cases...', 80, 'generating');
    
    // Group pages for flow-based test generation
    const pageGroups = this.groupPagesForFlowTesting();
    let totalTestsGenerated = 0;

    for (const group of pageGroups) {
      try {
        // Generate flow-based test cases for the group
        const testCases = await this.testGenerator.generateFlowTestCases(group);
        
        for (const testCase of testCases) {
          // Save test case to database
          await pool.query(`
            INSERT INTO test_cases (test_run_id, page_id, test_type, test_name, test_description, 
                                   test_steps, expected_result, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
          `, [
            this.testRunId, 
            group[0].id, // Associate with first page in group
            testCase.type, 
            testCase.name, 
            testCase.description,
            JSON.stringify(testCase.steps || []), 
            testCase.expectedResult
          ]);
          
          totalTestsGenerated++;
        }
        
        // Update progress
        const generationProgress = 80 + ((pageGroups.indexOf(group) + 1) / pageGroups.length) * 15;
        this.emitProgress(`Generated ${totalTestsGenerated} flow test cases...`, generationProgress, 'generating');
        
      } catch (error) {
        logger.error(`Error generating tests for page group: ${error.message}`);
      }
    }

    // Update final test count including both individual and flow tests
    await pool.query(`
      UPDATE test_runs 
      SET total_test_cases = (SELECT COUNT(*) FROM test_cases WHERE test_run_id = $1)
      WHERE id = $1
    `, [this.testRunId]);

    logger.info(`Flow test generation completed: ${totalTestsGenerated} flow test cases generated`);
    this.emitProgress(`Flow test generation completed: ${totalTestsGenerated} additional flow test cases generated`, 95, 'generating');
  }

  groupPagesForFlowTesting() {
    const groups = [];
    const testGenerationDepth = this.config.test_generation_depth || 3;
    
    // Group pages by URL path similarity and depth
    const pagesByDomain = {};
    
    for (const page of this.discoveredPages) {
      try {
        const url = new URL(page.url);
        const domain = url.hostname;
        const pathParts = url.pathname.split('/').filter(p => p);
        
        if (!pagesByDomain[domain]) {
          pagesByDomain[domain] = {};
        }
        
        // Group by first path segment (or root if none)
        const groupKey = pathParts.length > 0 ? pathParts[0] : 'root';
        
        if (!pagesByDomain[domain][groupKey]) {
          pagesByDomain[domain][groupKey] = [];
        }
        
        pagesByDomain[domain][groupKey].push(page);
      } catch (error) {
        // If URL parsing fails, create a single-page group
        groups.push([page]);
      }
    }
    
    // Create groups with specified depth
    for (const domain of Object.keys(pagesByDomain)) {
      for (const groupKey of Object.keys(pagesByDomain[domain])) {
        const pages = pagesByDomain[domain][groupKey];
        
        // Sort by crawl depth and take up to testGenerationDepth pages
        pages.sort((a, b) => (a.depth || 0) - (b.depth || 0));
        
        // Create groups of specified size
        for (let i = 0; i < pages.length; i += testGenerationDepth) {
          const group = pages.slice(i, i + testGenerationDepth);
          groups.push(group);
        }
      }
    }
    
    return groups.length > 0 ? groups : [this.discoveredPages.slice(0, testGenerationDepth)];
  }

  async updateRunStatus(status, errorMessage = null) {
    await pool.query(`
      UPDATE test_runs 
      SET status = $1, end_time = CURRENT_TIMESTAMP, error_message = $2
      WHERE id = $3
    `, [status, errorMessage, this.testRunId]);
  }

  emitProgress(message, percentage, phase) {
    this.io.emit('crawlerProgress', {
      testRunId: this.testRunId,
      message,
      percentage,
      phase: phase || this.phase,
      canStopCrawling: this.isRunning && this.phase === 'crawling' && !this.shouldStopCrawling,
      discoveredPagesCount: this.discoveredPages.length,
      timestamp: new Date().toISOString()
    });
    
    // Also log progress for debugging
    logger.info(`Crawler Progress [${this.testRunId}] [${phase}]: ${message} (${Math.round(percentage)}%)`);
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