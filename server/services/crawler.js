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
      
      // Perform intelligent interactions if LLM is available
      if (this.testGenerator && this.config.api_key) {
        await this.performIntelligentInteractions(page, url);
      } else {
        // Even without LLM, perform basic popup dismissal and continuation
        await this.performBasicInteractions(page, url);
      }
      
      const title = await page.title();
      const elements = await page.$$('*');
      const elementsCount = elements.length;

      // Take screenshot and save as base64 in database
      let screenshotData = null;
      let imageSize = 0;
      let imageFormat = 'png';
      let screenshotPath = null; // Keep for backward compatibility
      
      try {
        const screenshotBuffer = await page.screenshot({ 
          fullPage: true, 
          type: 'png',
          quality: 80 // Optimize file size
        });
        
        screenshotData = screenshotBuffer.toString('base64');
        imageSize = screenshotBuffer.length;
        imageFormat = 'png';
        
        // Also save to file system as backup (optional)
        const screenshotDir = path.join(__dirname, '../screenshots');
        if (!fs.existsSync(screenshotDir)) {
          await fs.promises.mkdir(screenshotDir, { recursive: true });
        }
        
        const screenshotFilename = `${this.testRunId}_${Date.now()}.png`;
        screenshotPath = path.join(screenshotDir, screenshotFilename);
        await fs.promises.writeFile(screenshotPath, screenshotBuffer);
        
        logger.info(`Screenshot saved to database and file: ${screenshotPath}`);
      } catch (screenshotError) {
        logger.warn(`Failed to take screenshot: ${screenshotError.message}`);
      }

      // Save discovered page
      const pageResult = await pool.query(`
        INSERT INTO discovered_pages (test_run_id, url, title, elements_count, screenshot_path, 
                                    screenshot_data, image_size, image_format, crawl_depth)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [this.testRunId, url, title, elementsCount, screenshotPath, screenshotData, imageSize, imageFormat, depth]);

      const pageId = pageResult.rows[0].id;
      const pageData = { id: pageId, url, title, elementsCount, depth };
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
        await page.goto(url, { 
          waitUntil: 'domcontentloaded', // Less strict than networkidle
          timeout: 15000 // Reduced timeout
        });
        
        // Wait for basic page elements
        await page.waitForTimeout(1000);
        return;
        
      } catch (error) {
        attempt++;
        logger.warn(`Navigation attempt ${attempt} failed for ${url}: ${error.message}`);
        
        if (attempt >= maxRetries) {
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
      
      // Ask LLM for interaction suggestions
      const interactions = await this.getInteractionSuggestions(pageContext, url);
      
      // Execute suggested interactions
      for (const interaction of interactions) {
        try {
          await this.executeInteraction(page, interaction);
          await page.waitForTimeout(1000); // Wait between interactions
        } catch (error) {
          logger.warn(`Failed to execute interaction: ${error.message}`);
        }
      }
      
    } catch (error) {
      logger.warn(`Intelligent interactions failed for ${url}: ${error.message}`);
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
      const prompt = `
Analyze this web page and suggest intelligent interactions to discover more content:

URL: ${url}
Title: ${pageContext.title}

Page Elements:
- Forms: ${JSON.stringify(pageContext.forms, null, 2)}
- Buttons: ${JSON.stringify(pageContext.buttons, null, 2)}
- Dropdowns: ${JSON.stringify(pageContext.selects, null, 2)}
- Has Modals: ${pageContext.hasModals}

Page Content Preview: ${pageContext.bodyText}

Suggest 2-3 intelligent interactions that would help discover more content or navigate deeper into the application. Focus on:
1. Filling forms with realistic test data
2. Clicking navigation buttons
3. Selecting dropdown options
4. Dismissing modals/popups

Return as JSON array:
[
  {
    "type": "fill|click|select|dismiss",
    "selector": "CSS selector",
    "value": "value to enter (for fill/select)",
    "description": "What this interaction does"
  }
]

Only suggest safe, non-destructive interactions. Avoid submit buttons unless necessary.
`;

      const response = await this.testGenerator.callLLM(prompt);
      const suggestions = JSON.parse(response);
      
      return Array.isArray(suggestions) ? suggestions.slice(0, 3) : [];
      
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