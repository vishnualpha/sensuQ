const { chromium } = require('playwright');
const logger = require('../utils/logger');
const { VisionElementIdentifier } = require('./visionElementIdentifier');
const { PageLevelTestGenerator } = require('./pageLevelTestGenerator');
const { FlowLevelTestGenerator } = require('./flowLevelTestGenerator');
const IntelligentInteractionPlanner = require('./intelligentInteractionPlanner');
const IntelligentTestAdapter = require('./intelligentTestAdapter');
const SPAStateDetector = require('./spaStateDetector');
const BrowserPoolManager = require('./browserPoolManager');
const PathNavigator = require('./pathNavigator');
const { pool } = require('../config/database');
const { generatePageName } = require('../utils/pageNameGenerator');

/**
 * Autonomous crawler that uses vision LLM to identify and interact with elements
 */
class AutonomousCrawler {
  constructor(testRunId, testConfig, llmConfig, io = null) {
    this.testRunId = testRunId;
    this.testConfig = testConfig;
    this.llmConfig = llmConfig;
    this.io = io;

    logger.info(`AutonomousCrawler initialized with credentials:`);
    logger.info(`  auth_username: ${testConfig.auth_username || 'NOT SET'}`);
    logger.info(`  auth_password: ${testConfig.auth_password ? '***SET***' : 'NOT SET'}`);
    this.visionIdentifier = new VisionElementIdentifier(llmConfig);
    this.pageTestGenerator = new PageLevelTestGenerator(llmConfig);
    this.flowTestGenerator = new FlowLevelTestGenerator(llmConfig);
    this.interactionPlanner = new IntelligentInteractionPlanner(llmConfig);
    this.testAdapter = new IntelligentTestAdapter(llmConfig);
    this.stateDetector = new SPAStateDetector();

    this.browser = null;
    this.context = null;
    this.page = null;
    this.browserPool = null;

    this.visitedUrls = new Set();
    this.crawlPaths = [];
    this.shouldStop = false;
    this.isPaused = false;
    this.currentDepth = 0;
    this.pagesDiscovered = 0;
    this.pathSequence = 0;
    this.virtualPageCounter = 0;

    const maxConcurrentBrowsers = this.testConfig.max_concurrent_browsers || 3;
    this.maxParallelCrawls = Math.min(maxConcurrentBrowsers, 5);
  }

  /**
   * Start crawling from base URL using breadth-first approach
   */
  async start() {
    try {
      logger.info(`Starting autonomous crawl for test run ${this.testRunId}`);
      logger.info(`Target URL: ${this.testConfig.target_url}`);
      logger.info(`Max Depth: ${this.testConfig.max_depth}, Max Pages: ${this.testConfig.max_pages}`);
      logger.info(`🔄 Using BREADTH-FIRST crawling strategy`);

      this.shouldStop = false;

      const baseStep = PathNavigator.createGotoStep(this.testConfig.target_url);
      await this.enqueueUrl(this.testConfig.target_url, 0, null, null, 'high', [baseStep]);

      await this.processBreadthFirstQueue();

      if (this.shouldStop) {
        logger.info(`Crawl stopped by user. Discovered ${this.pagesDiscovered} pages`);
      } else {
        logger.info(`Crawl completed. Discovered ${this.pagesDiscovered} pages`);
      }

      // Emit test generation phase
      if (this.io) {
        this.io.emit('crawlerProgress', {
          testRunId: this.testRunId,
          phase: 'generating',
          discoveredPagesCount: this.pagesDiscovered,
          message: 'Generating test cases from discovered pages...',
          percentage: 90,
          canStopCrawling: false
        });
      }

      // Generate flow-level tests after crawl completes
      logger.info('Generating flow-level tests from crawl paths...');
      await this.flowTestGenerator.generateFlows(this.testRunId);

      await this.updateTestRunStats();

      // Get updated stats after saving
      const statsResult = await pool.query(
        'SELECT total_test_cases, coverage_percentage FROM test_runs WHERE id = $1',
        [this.testRunId]
      );
      const stats = statsResult.rows[0];

      // Emit completion with stats
      if (this.io) {
        this.io.emit('crawlerProgress', {
          testRunId: this.testRunId,
          phase: 'completed',
          discoveredPagesCount: this.pagesDiscovered,
          totalTestCases: stats.total_test_cases,
          coveragePercentage: stats.coverage_percentage,
          message: 'Crawling and test generation completed!',
          percentage: 100,
          canStopCrawling: false
        });
      }

      return {
        success: true,
        pagesDiscovered: this.pagesDiscovered,
        pathsExplored: this.crawlPaths.length
      };
    } catch (error) {
      logger.error(`Crawl failed: ${error.message}`);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Initialize browser instance
   */
  async initializeBrowser() {
    this.browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'SensuQ-Autonomous-Tester/1.0'
    });

    this.page = await this.context.newPage();

    logger.info('Browser initialized successfully');
  }

  /**
   * Crawl a single page
   */
  async crawlPage(url, fromPageId, interactionElementId, depth) {
    // Check limits
    if (depth > this.testConfig.max_depth) {
      logger.info(`Max depth ${this.testConfig.max_depth} reached, stopping`);
      return;
    }

    if (this.pagesDiscovered >= this.testConfig.max_pages) {
      logger.info(`Max pages ${this.testConfig.max_pages} reached, stopping`);
      return;
    }

    // Check if already visited
    if (this.visitedUrls.has(url)) {
      logger.info(`URL already visited: ${url}`);
      return;
    }

    try {
      logger.info(`Crawling page (depth ${depth}): ${url}`);

      // Navigate to page with retries
      let navigationSuccess = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await this.page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 45000
          });
          navigationSuccess = true;
          break;
        } catch (navError) {
          logger.warn(`Navigation attempt ${attempt + 1} failed: ${navError.message}`);
          if (attempt === 1) throw navError;
          await this.page.waitForTimeout(2000);
        }
      }

      if (!navigationSuccess) {
        throw new Error('Failed to navigate after retries');
      }

      await this.page.waitForTimeout(2000); // Wait for dynamic content

      // Proactively dismiss popups/modals before analyzing the page
      try {
        await Promise.race([
          this.handlePopupsAndModals(this.page),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Popup handling timeout')), 8000))
        ]);
      } catch (popupError) {
        logger.warn(`Popup handling timed out or failed: ${popupError.message}`);
      }

      this.visitedUrls.add(url);
      this.pagesDiscovered++;

      // Emit progress update via socket.io
      if (this.io) {
        const percentage = Math.min((this.pagesDiscovered / this.testConfig.max_pages) * 100, 100);
        const progressData = {
          testRunId: this.testRunId,
          phase: 'crawling',
          discoveredPagesCount: this.pagesDiscovered,
          maxPages: this.testConfig.max_pages,
          message: `Discovered ${this.pagesDiscovered}/${this.testConfig.max_pages} pages - Currently on: ${url}`,
          percentage: percentage,
          canStopCrawling: this.pagesDiscovered > 1 || depth > 0,
          currentUrl: url,
          depth: depth
        };
        logger.info(`📡 Emitting crawlerProgress: ${JSON.stringify(progressData)}`);
        this.io.emit('crawlerProgress', progressData);
      }

      // Capture page data
      const screenshot = await this.page.screenshot({ fullPage: false });
      const screenshotBase64 = screenshot.toString('base64');
      const pageSource = await this.page.content();
      const title = await this.page.title();

      // Identify interactive elements using vision LLM
      const analysis = await this.visionIdentifier.identifyInteractiveElements(
        screenshotBase64,
        pageSource,
        url
      );

      logger.info(`Identified ${analysis.interactiveElements.length} interactive elements on ${analysis.screenName}`);

      // Save page to database
      const pageId = await this.saveDiscoveredPage(
        url,
        title,
        analysis.screenName,
        analysis.pageType,
        screenshotBase64,
        pageSource,
        analysis.interactiveElements.length,
        depth
      );

      // Save interactive elements
      await this.saveInteractiveElements(pageId, analysis.interactiveElements);

      // Record crawl path
      if (fromPageId) {
        await this.saveCrawlPath(fromPageId, pageId, interactionElementId, depth);
      }

      // Generate interaction scenarios using LLM
      const scenarios = await this.interactionPlanner.generateScenarios(
        pageId,
        this.testRunId,
        url,
        title,
        analysis.screenName,
        analysis.pageType,
        screenshotBase64,
        pageSource,
        analysis.interactiveElements
      );

      logger.info(`🎯 Generated ${scenarios.length} meaningful interaction scenarios`);

      // Generate page-level tests
      await this.generatePageTests(pageId, url, analysis, analysis.interactiveElements);

      // Update database stats periodically (every page)
      await this.updateRunningStats();

      // Execute scenarios instead of blind element clicking
      for (const scenario of scenarios) {
        if (depth >= this.testConfig.max_depth || this.pagesDiscovered >= this.testConfig.max_pages) {
          break;
        }

        logger.info(`🎬 Executing scenario: "${scenario.name}"`);
        await this.executeScenario(scenario, pageId, depth);
      }

    } catch (error) {
      logger.error(`Error crawling page ${url}: ${error.message}`);

      // If we can't navigate or page fails, skip and continue
      if (error.message.includes('Timeout') || error.message.includes('Navigation')) {
        logger.warn(`Skipping page due to timeout/navigation error: ${url}`);
        // Don't restart browser on first page, just mark as failed and continue
        if (depth === 0) {
          logger.error('Cannot load base URL, stopping crawl');
          throw error;
        }
      }
    }
  }

  /**
   * Crawl a single page using specific browser (path-based with step sequences)
   */
  async crawlPageWithBrowser(url, fromPageId, interactionElementId, depth, browser, parentSteps = []) {
    if (depth > this.testConfig.max_depth) {
      logger.info(`Max depth ${this.testConfig.max_depth} reached, stopping`);
      return;
    }

    if (this.pagesDiscovered >= this.testConfig.max_pages) {
      logger.info(`Max pages ${this.testConfig.max_pages} reached, stopping`);
      return;
    }

    if (this.visitedUrls.has(url)) {
      logger.info(`URL already visited: ${url}`);
      return;
    }

    try {
      const page = browser.page;
      logger.info(`Crawling page (depth ${depth}): ${url}`);

      await page.waitForTimeout(2000);

      try {
        await Promise.race([
          this.handlePopupsAndModals(page),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Popup handling timeout')), 8000))
        ]);
      } catch (popupError) {
        logger.warn(`Popup handling timed out or failed: ${popupError.message}`);
      }

      this.visitedUrls.add(url);
      this.pagesDiscovered++;

      if (this.io) {
        const percentage = Math.min((this.pagesDiscovered / this.testConfig.max_pages) * 100, 100);
        const progressData = {
          testRunId: this.testRunId,
          phase: 'crawling',
          discoveredPagesCount: this.pagesDiscovered,
          maxPages: this.testConfig.max_pages,
          message: `Discovered ${this.pagesDiscovered}/${this.testConfig.max_pages} pages - Currently on: ${url}`,
          percentage: percentage,
          canStopCrawling: this.pagesDiscovered > 1 || depth > 0,
          currentUrl: url,
          depth: depth
        };
        logger.info(`📡 Emitting crawlerProgress: ${JSON.stringify(progressData)}`);
        this.io.emit('crawlerProgress', progressData);
      }

      const screenshot = await page.screenshot({ fullPage: false });
      const screenshotBase64 = screenshot.toString('base64');
      const pageSource = await page.content();
      const title = await page.title();

      const analysis = await this.visionIdentifier.identifyInteractiveElements(
        screenshotBase64,
        pageSource,
        url
      );

      logger.info(`Identified ${analysis.interactiveElements.length} interactive elements on ${analysis.screenName}`);

      const pageId = await this.saveDiscoveredPage(
        url,
        title,
        analysis.screenName,
        analysis.pageType,
        screenshotBase64,
        pageSource,
        analysis.interactiveElements.length,
        depth
      );

      await this.saveInteractiveElements(pageId, analysis.interactiveElements);

      if (fromPageId) {
        await this.saveCrawlPathWithSteps(fromPageId, pageId, interactionElementId, depth, parentSteps);
      }

      const scenarios = await this.interactionPlanner.generateScenarios(
        pageId,
        this.testRunId,
        url,
        title,
        analysis.screenName,
        analysis.pageType,
        screenshotBase64,
        pageSource,
        analysis.interactiveElements
      );

      logger.info(`🎯 Generated ${scenarios.length} meaningful interaction scenarios`);

      await this.generatePageTestsWithPrerequisites(pageId, url, analysis, analysis.interactiveElements, parentSteps);

      await this.updateRunningStats();

      logger.info(`  ✅ Generated ${scenarios.length} scenarios for flow-level tests (will be processed after crawl)`)

      try {
        await this.discoverAndEnqueueLinks(browser.page, pageId, url, analysis, depth, parentSteps);
      } catch (linkDiscoveryError) {
        logger.error(`Link discovery failed for ${url}: ${linkDiscoveryError.message}`);
        logger.warn(`Continuing with crawl despite link discovery failure`);
      }

    } catch (error) {
      logger.error(`Error crawling page ${url}: ${error.message}`);

      if (error.message.includes('Timeout') || error.message.includes('Navigation')) {
        logger.warn(`Skipping page due to timeout/navigation error: ${url}`);
        if (depth === 0) {
          logger.error('Cannot load base URL, stopping crawl');
          throw error;
        }
      }
    }
  }

  /**
   * Interact with an element and handle navigation
   */
  async interactWithElement(element, currentPageId, currentDepth) {
    try {
      logger.info(`Attempting to interact with: ${element.element_type} - "${element.text_content}"`);

      const currentUrl = this.page.url();

      // Wait for element to be ready
      const selector = element.selector;
      await this.page.waitForSelector(selector, { timeout: 5000 });

      // Check if element is visible
      const isVisible = await this.page.isVisible(selector);
      if (!isVisible) {
        logger.info(`Element not visible: ${selector}`);
        return false;
      }

      // Perform interaction based on element type
      if (element.element_type === 'link' || element.element_type === 'button') {
        // Click element
        await Promise.all([
          this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}),
          this.page.click(selector)
        ]);

        await this.page.waitForTimeout(2000);

        const newUrl = this.page.url();

        // Check if navigation occurred
        if (newUrl !== currentUrl && !this.visitedUrls.has(newUrl)) {
          logger.info(`Navigation detected: ${currentUrl} -> ${newUrl}`);

          // Get element ID for this interaction
          const elementId = await this.getElementIdBySelector(currentPageId, selector);

          // Recursively crawl the new page
          await this.crawlPage(newUrl, currentPageId, elementId, currentDepth + 1);

          // Navigate back to continue crawling
          try {
            await this.page.goBack({ waitUntil: 'networkidle', timeout: 10000 });
            await this.page.waitForTimeout(1000);
          } catch (backError) {
            logger.warn(`Cannot navigate back, will restart browser: ${backError.message}`);
            return false;
          }

          return true;
        }

      } else if (element.element_type === 'input') {
        // Fill input with test data
        await this.page.fill(selector, 'test data');
        logger.info(`Filled input: ${selector}`);
        return true;

      } else if (element.element_type === 'select') {
        // Select first option
        const options = await this.page.$$eval(`${selector} option`, opts => opts.map(o => o.value));
        if (options.length > 1) {
          await this.page.selectOption(selector, options[1]);
          logger.info(`Selected option in: ${selector}`);
        }
        return true;
      }

      return false;

    } catch (error) {
      logger.warn(`Failed to interact with element: ${error.message}`);
      return false;
    }
  }

  /**
   * Execute an interaction scenario
   */
  async executeScenario(scenario, currentPageId, currentDepth) {
    try {
      const startUrl = this.page.url();
      let scenarioSuccess = true;
      let lastStepError = null;

      logger.info(`📋 Executing ${scenario.steps.length} steps for scenario: "${scenario.name}"`);

      await this.stateDetector.captureStateSnapshot(this.page, 'before_scenario');

      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        logger.info(`  Step ${i + 1}: ${step.action} on ${step.elementType} - "${step.textContent || step.selector}"`);

        try {
          await this.executeScenarioStep(step);
          await this.stateDetector.waitForStateSettlement(this.page);
        } catch (stepError) {
          logger.warn(`  ❌ Step ${i + 1} failed: ${stepError.message}`);
          lastStepError = stepError.message;

          // Use LLM to analyze failure and suggest fix
          logger.info(`  🤖 Asking LLM for help with failed step...`);
          try {
            const screenshotBase64 = await this.page.screenshot({ encoding: 'base64', fullPage: false });
            const pageSource = await this.page.content();
            const intent = step.expectedOutcome || `${step.action} on ${step.textContent}`;

            const analysis = await this.testAdapter.analyzeFailureAndSuggestFix(
              step,
              stepError.message,
              screenshotBase64,
              pageSource,
              intent
            );

            if (analysis && analysis.canAchieveIntent && analysis.alternativeSteps.length > 0) {
              logger.info(`  💡 LLM diagnosis: ${analysis.diagnosis}`);
              logger.info(`  🔄 Trying ${analysis.alternativeSteps.length} alternative steps...`);

              await this.testAdapter.executeAlternativeSteps(this.page, analysis.alternativeSteps, this);
              await this.stateDetector.waitForStateSettlement(this.page);

              // Verify if intent was achieved
              const afterScreenshot = await this.page.screenshot({ encoding: 'base64', fullPage: false });
              const verification = await this.testAdapter.verifyIntentAchieved(
                this.page,
                intent,
                afterScreenshot
              );

              if (verification.achieved) {
                logger.info(`  ✅ LLM adaptation succeeded! Continuing scenario...`);
                continue;
              } else {
                logger.warn(`  ⚠️ LLM adaptation didn't achieve intent: ${verification.evidence}`);
                scenarioSuccess = false;
                break;
              }
            } else {
              logger.warn(`  ⚠️ LLM couldn't suggest a fix`);
              scenarioSuccess = false;
              break;
            }
          } catch (adaptError) {
            logger.error(`  ❌ LLM adaptation failed: ${adaptError.message}`);
            scenarioSuccess = false;
            break;
          }
        }
      }

      const endUrl = this.page.url();

      const stateChange = await this.stateDetector.detectStateChange(
        this.page,
        'before_scenario',
        'after_scenario',
        scenario.name
      );

      if (stateChange.significant && endUrl === startUrl) {
        logger.info(`  🎭 SPA State Change Detected: ${stateChange.changes.changeType}`);
        await this.handleVirtualPage(stateChange.virtualPage, currentPageId, currentDepth);
      }

      const scenarioResult = await pool.query(
        'SELECT id FROM interaction_scenarios WHERE page_id = $1 AND scenario_name = $2',
        [currentPageId, scenario.name]
      );
      const scenarioId = scenarioResult.rows.length > 0 ? scenarioResult.rows[0].id : null;

      if (endUrl !== startUrl && !this.visitedUrls.has(endUrl)) {
        logger.info(`  ✅ Scenario led to new page: ${endUrl}`);

        if (currentDepth + 1 <= this.testConfig.max_depth) {
          await this.enqueueUrl(endUrl, currentDepth + 1, currentPageId, scenarioId, scenario.priority);
        }

        try {
          await this.page.goBack({ waitUntil: 'networkidle', timeout: 10000 });
          await this.page.waitForTimeout(1000);
        } catch (backError) {
          logger.warn(`  Cannot navigate back: ${backError.message}`);
        }
      } else if (endUrl === startUrl) {
        logger.info(`  ℹ️ Scenario completed on same page (in-page interaction)`);
      }

      if (scenarioId) {
        await this.interactionPlanner.markScenarioExecuted(
          scenarioId,
          scenarioSuccess,
          null,
          lastStepError
        );
      }

      return scenarioSuccess;

    } catch (error) {
      logger.error(`  ❌ Scenario execution failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Execute a single scenario step
   */
  async executeScenarioStep(step) {
    let selector = step.selector;
    let elementFound = false;

    // Handle invalid Playwright locator syntax that LLM might generate
    if (selector.includes(':has-text(')) {
      const textMatch = selector.match(/:has-text\("([^"]+)"\)/);
      if (textMatch) {
        const textContent = textMatch[1];
        logger.warn(`Invalid selector syntax detected: ${selector}`);
        logger.info(`Attempting to find element by text: "${textContent}"`);

        const locator = this.page.locator(`text="${textContent}"`);
        const count = await locator.count();

        if (count === 0) {
          throw new Error(`Element with text "${textContent}" not found`);
        }

        const isVisible = await locator.first().isVisible();
        if (!isVisible) {
          throw new Error(`Element with text "${textContent}" not visible`);
        }

        return await this.executeStepWithLocator(step, locator.first());
      }
    }

    // Try the provided selector first
    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });
      const isVisible = await this.page.isVisible(selector);
      if (isVisible) {
        elementFound = true;
      }
    } catch (e) {
      logger.warn(`Selector not found: ${selector}`);

      // Try to find by text content if available
      if (step.textContent) {
        logger.info(`Attempting to find element by text: "${step.textContent}"`);
        const alternatives = [
          `text="${step.textContent}"`,
          `button:has-text("${step.textContent}")`,
          `a:has-text("${step.textContent}")`,
          `input[placeholder*="${step.textContent}" i]`,
          `[aria-label*="${step.textContent}" i]`
        ];

        for (const altSelector of alternatives) {
          try {
            const locator = this.page.locator(altSelector).first();
            const count = await locator.count();
            if (count > 0 && await locator.isVisible()) {
              logger.info(`Found element using alternative: ${altSelector}`);
              return await this.executeStepWithLocator(step, locator);
            }
          } catch (e2) {
            continue;
          }
        }
      }

      throw new Error(`Element not found and no working alternative: ${selector}`);
    }

    switch (step.action) {
      case 'click':
      case 'check':
        await this.smartClick(this.page, selector);
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        break;

      case 'fill':
        let fillValue = step.value || 'test data';

        if (fillValue === '{auth_username}' && this.testConfig.auth_username) {
          logger.info(`Substituting {auth_username} with configured username: ${this.testConfig.auth_username}`);
          fillValue = this.testConfig.auth_username;
        } else if (fillValue === '{auth_password}' && this.testConfig.auth_password) {
          logger.info(`Substituting {auth_password} with configured password`);
          fillValue = this.testConfig.auth_password;
        } else if (fillValue === '{auth_username}' || fillValue === '{auth_password}') {
          logger.warn(`Placeholder ${fillValue} found but no credentials configured!`);
          logger.warn(`testConfig.auth_username: ${this.testConfig.auth_username}`);
          logger.warn(`testConfig.auth_password: ${this.testConfig.auth_password ? '***' : 'null'}`);
        }

        await this.smartFill(this.page, selector, fillValue);
        break;

      case 'select':
        const valueToSelect = step.value || null;
        await this.smartSelect(this.page, selector, valueToSelect);
        break;

      case 'hover':
        await this.page.hover(selector);
        break;

      default:
        logger.warn(`Unknown action type: ${step.action}`);
    }
  }

  /**
   * Execute step using Playwright locator (for fallback scenarios)
   */
  async executeStepWithLocator(step, locator) {
    switch (step.action) {
      case 'click':
        await Promise.all([
          this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}),
          locator.click()
        ]);
        break;

      case 'fill':
        let fillValue = step.value || 'test data';

        if (fillValue === '{auth_username}' && this.testConfig.auth_username) {
          logger.info(`[Locator] Substituting {auth_username} with configured username: ${this.testConfig.auth_username}`);
          fillValue = this.testConfig.auth_username;
        } else if (fillValue === '{auth_password}' && this.testConfig.auth_password) {
          logger.info(`[Locator] Substituting {auth_password} with configured password`);
          fillValue = this.testConfig.auth_password;
        } else if (fillValue === '{auth_username}' || fillValue === '{auth_password}') {
          logger.warn(`[Locator] Placeholder ${fillValue} found but no credentials configured!`);
          logger.warn(`testConfig.auth_username: ${this.testConfig.auth_username}`);
          logger.warn(`testConfig.auth_password: ${this.testConfig.auth_password ? '***' : 'null'}`);
        }

        await locator.fill(fillValue);
        break;

      case 'select':
        const valueToSelect = step.value || '';
        await locator.selectOption(valueToSelect);
        break;

      case 'check':
        await locator.check();
        break;

      case 'hover':
        await locator.hover();
        break;

      default:
        logger.warn(`Unknown action type: ${step.action}`);
    }
  }

  /**
   * Restart browser for exploring new path
   */
  async restartBrowserForNewPath() {
    logger.info('Restarting browser to explore new path from beginning');

    try {
      // Close current browser
      if (this.page) await this.page.close().catch(() => {});
      if (this.context) await this.context.close().catch(() => {});
      if (this.browser) await this.browser.close().catch(() => {});

      // Get unexplored paths from database
      const unexploredPaths = await this.getUnexploredPaths();

      if (unexploredPaths.length === 0) {
        logger.info('No more unexplored paths available');
        return;
      }

      // Reinitialize browser
      await this.initializeBrowser();

      // Try to follow an unexplored path
      // For now, just restart from base - path selection logic can be enhanced
      logger.info('Browser restarted, continuing crawl');

    } catch (error) {
      logger.error(`Failed to restart browser: ${error.message}`);
    }
  }

  /**
   * Enqueue a URL for breadth-first crawling with complete step sequence
   */
  async enqueueUrl(url, depth, fromPageId, scenarioId, priority = 'medium', requiredSteps = []) {
    try {
      if (this.visitedUrls.has(url)) {
        return;
      }

      const existing = await pool.query(
        'SELECT id FROM page_discovery_queue WHERE test_run_id = $1 AND url = $2',
        [this.testRunId, url]
      );

      if (existing.rows.length > 0) {
        return;
      }

      await pool.query(
        `INSERT INTO page_discovery_queue
         (test_run_id, url, depth_level, from_page_id, scenario_id, priority, status, required_steps)
         VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)`,
        [this.testRunId, url, depth, fromPageId, scenarioId, priority, JSON.stringify(requiredSteps)]
      );

      logger.info(`📥 Enqueued: ${url} (depth: ${depth}, steps: ${requiredSteps.length}, priority: ${priority})`);
    } catch (error) {
      logger.error(`Failed to enqueue URL ${url}: ${error.message}`);
    }
  }

  /**
   * Process the queue using breadth-first strategy with parallel crawling
   */
  async processBreadthFirstQueue() {
    let currentDepth = 0;
    let processedCount = 0;

    while (currentDepth <= this.testConfig.max_depth && this.pagesDiscovered < this.testConfig.max_pages && !this.shouldStop) {
      logger.info(`\n📊 Processing depth level: ${currentDepth}`);

      const queueItems = await pool.query(
        `SELECT * FROM page_discovery_queue
         WHERE test_run_id = $1
         AND status = 'queued'
         AND depth_level = $2
         ORDER BY
           CASE priority
             WHEN 'high' THEN 1
             WHEN 'medium' THEN 2
             WHEN 'low' THEN 3
           END,
           id ASC`,
        [this.testRunId, currentDepth]
      );

      if (queueItems.rows.length === 0) {
        logger.info(`No more pages at depth ${currentDepth}, moving to next level`);
        currentDepth++;
        continue;
      }

      logger.info(`Found ${queueItems.rows.length} pages to process at depth ${currentDepth}`);

      const browsersNeeded = Math.min(queueItems.rows.length, this.maxParallelCrawls);
      logger.info(`🚀 Launching ${browsersNeeded} browser(s) for ${queueItems.rows.length} page(s)`);

      this.browserPool = new BrowserPoolManager(browsersNeeded);
      await this.browserPool.initialize();

      try {
        const results = await this.processItemsInParallel(queueItems.rows, currentDepth);
        processedCount += results.filter(r => r && r.success).length;
      } finally {
        await this.browserPool.closeAll();
        this.browserPool = null;
      }

      currentDepth++;
    }

    logger.info(`✅ Queue processing complete. Processed ${processedCount} items.`);
  }

  /**
   * Process queue items in parallel using browser pool
   */
  async processItemsInParallel(items, depth) {
    const results = [];
    const queue = [...items];

    const workers = Array(this.maxParallelCrawls).fill(null).map(async (_, workerIndex) => {
      logger.info(`👷 Worker ${workerIndex + 1} started`);

      while (queue.length > 0 && !this.shouldStop) {
        while (this.isPaused && !this.shouldStop) {
          logger.info(`Worker ${workerIndex + 1} paused. Waiting...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (this.shouldStop || this.pagesDiscovered >= this.testConfig.max_pages) {
          break;
        }

        const item = queue.shift();
        if (!item) break;

        const browser = await this.browserPool.acquireBrowser();

        try {
          logger.info(`👷 Worker ${workerIndex + 1} processing: ${item.url}`);
          const result = await this.processQueueItemWithBrowser(item, browser, depth);
          results.push(result);
        } catch (error) {
          logger.error(`Worker ${workerIndex + 1} error: ${error.message}`);
          results.push({ success: false, error: error.message });
        } finally {
          await this.browserPool.resetBrowser(browser);
          this.browserPool.releaseBrowser(browser);
        }
      }

      logger.info(`👷 Worker ${workerIndex + 1} finished`);
    });

    await Promise.allSettled(workers);
    return results;
  }

  /**
   * Process a single queue item with a specific browser (path-based navigation)
   */
  async processQueueItemWithBrowser(item, browser, depth) {
    try {
      await pool.query(
        `UPDATE page_discovery_queue
         SET status = 'processing', started_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [item.id]
      );

      logger.info(`\n🌐 [Depth ${item.depth_level}] Path-based crawling: ${item.url}`);

      const requiredSteps = item.required_steps
        ? (typeof item.required_steps === 'string' ? JSON.parse(item.required_steps) : item.required_steps)
        : [];
      logger.info(`  Required steps from base URL: ${requiredSteps.length}`);

      const navigator = new PathNavigator(browser.page);

      if (requiredSteps.length > 0) {
        await navigator.executeSteps(requiredSteps);
      } else {
        await navigator.executeStep(PathNavigator.createGotoStep(item.url));
      }

      await this.crawlPageWithBrowser(
        item.url,
        item.from_page_id,
        null,
        item.depth_level,
        browser,
        requiredSteps
      );

      const discoveredPage = await pool.query(
        'SELECT id FROM discovered_pages WHERE test_run_id = $1 AND url = $2',
        [this.testRunId, item.url]
      );

      const discoveredPageId = discoveredPage.rows.length > 0 ? discoveredPage.rows[0].id : null;

      await pool.query(
        `UPDATE page_discovery_queue
         SET status = 'completed',
             completed_at = CURRENT_TIMESTAMP,
             discovered_page_id = $2
         WHERE id = $1`,
        [item.id, discoveredPageId]
      );

      return { success: true, pageId: discoveredPageId };

    } catch (error) {
      logger.error(`Failed to process queue item ${item.url}: ${error.message}`);

      await pool.query(
        `UPDATE page_discovery_queue
         SET status = 'failed',
             error_message = $2,
             completed_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [item.id, error.message]
      );

      return { success: false, error: error.message };
    }
  }

  /**
   * Handle virtual page (SPA state change)
   */
  async handleVirtualPage(virtualPage, parentPageId, depth) {
    try {
      this.virtualPageCounter++;
      const virtualUrl = `${virtualPage.baseUrl}#virtual-${this.virtualPageCounter}`;

      logger.info(`  💾 Saving virtual page: ${virtualPage.stateIdentifier}`);

      const screenshot = await this.page.screenshot({ encoding: 'base64', fullPage: false });
      const pageSource = await this.page.content();
      const imageSize = screenshot ? screenshot.length : 0;
      const imageFormat = 'png';

      const result = await pool.query(
        `INSERT INTO discovered_pages
         (test_run_id, url, title, screen_name, page_type, elements_count, screenshot_path, screenshot_data, image_size, image_format, page_source, crawl_depth,
          is_virtual, state_identifier, triggered_by_action, parent_page_id, state_metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING id`,
        [
          this.testRunId,
          virtualUrl,
          `Virtual: ${virtualPage.changeType}`,
          virtualPage.stateIdentifier,
          virtualPage.changeType,
          0,
          `virtual_${this.virtualPageCounter}.png`,
          screenshot,
          imageSize,
          imageFormat,
          pageSource,
          depth,
          true,
          virtualPage.stateIdentifier,
          virtualPage.triggeredBy,
          parentPageId,
          JSON.stringify(virtualPage.changes)
        ]
      );

      const virtualPageId = result.rows[0].id;
      logger.info(`  ✅ Virtual page saved with ID: ${virtualPageId}`);

      await this.interactionPlanner.generateScenarios(
        virtualPageId,
        this.testRunId,
        virtualUrl,
        `Virtual: ${virtualPage.changeType}`,
        `Virtual: ${virtualPage.changeType}`,
        virtualPage.changeType,
        screenshot,
        pageSource,
        []
      );

      return virtualPageId;
    } catch (error) {
      logger.error(`Failed to handle virtual page: ${error.message}`);
      return null;
    }
  }

  /**
   * Save discovered page to database
   */
  async saveDiscoveredPage(url, title, screenName, pageType, screenshot, pageSource, elementsCount, depth) {
    const screenshotPath = `screenshots/${this.testRunId}_${Date.now()}.png`;
    const imageSize = screenshot ? screenshot.length : 0;
    const imageFormat = 'png';

    // Generate a friendly page name if screenName is not provided or is generic
    let finalScreenName = screenName;
    if (!screenName || screenName === title || screenName === 'DEMOQA') {
      finalScreenName = generatePageName(url, title);
      logger.info(`Generated page name: "${finalScreenName}" for ${url}`);
    }

    const result = await pool.query(
      `INSERT INTO discovered_pages (test_run_id, url, title, screen_name, page_type, elements_count, screenshot_path, screenshot_data, image_size, image_format, page_source, crawl_depth)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [this.testRunId, url, title, finalScreenName, pageType, elementsCount, screenshotPath, screenshot, imageSize, imageFormat, pageSource, depth]
    );

    return result.rows[0].id;
  }

  /**
   * Save interactive elements to database
   */
  async saveInteractiveElements(pageId, elements) {
    for (const element of elements) {
      await pool.query(
        `INSERT INTO page_interactive_elements (page_id, element_type, selector, text_content, attributes, interaction_priority, identified_by, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          pageId,
          element.element_type,
          element.selector,
          element.text_content,
          JSON.stringify(element.attributes),
          element.interaction_priority,
          element.identified_by,
          JSON.stringify(element.metadata)
        ]
      );
    }
  }

  /**
   * Save crawl path to database
   */
  async saveCrawlPath(fromPageId, toPageId, interactionElementId, depth) {
    this.pathSequence++;

    await pool.query(
      `INSERT INTO crawl_paths (test_run_id, from_page_id, to_page_id, interaction_element_id, interaction_type, path_sequence, depth_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (test_run_id, from_page_id, to_page_id, interaction_element_id) DO NOTHING`,
      [this.testRunId, fromPageId, toPageId, interactionElementId, 'click', this.pathSequence, depth]
    );
  }

  async saveCrawlPathWithSteps(fromPageId, toPageId, interactionElementId, depth, completeSteps) {
    this.pathSequence++;

    await pool.query(
      `INSERT INTO crawl_paths
       (test_run_id, from_page_id, to_page_id, interaction_element_id, interaction_type, path_sequence, depth_level, complete_step_sequence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (test_run_id, from_page_id, to_page_id, interaction_element_id)
       DO UPDATE SET complete_step_sequence = $8`,
      [this.testRunId, fromPageId, toPageId, interactionElementId, 'click', this.pathSequence, depth, JSON.stringify(completeSteps)]
    );

    logger.info(`  💾 Saved crawl path with ${completeSteps.length} steps`);
  }

  /**
   * Mark page as dead-end
   */
  async markPageAsDeadEnd(pageId) {
    await pool.query(
      `UPDATE crawl_paths SET is_dead_end = true WHERE to_page_id = $1`,
      [pageId]
    );
  }

  /**
   * Get element ID by selector
   */
  async getElementIdBySelector(pageId, selector) {
    const result = await pool.query(
      `SELECT id FROM page_interactive_elements WHERE page_id = $1 AND selector = $2 LIMIT 1`,
      [pageId, selector]
    );

    return result.rows.length > 0 ? result.rows[0].id : null;
  }

  /**
   * Get unexplored paths
   */
  async getUnexploredPaths() {
    const result = await pool.query(
      `SELECT DISTINCT pie.id, pie.selector, dp.url
       FROM page_interactive_elements pie
       JOIN discovered_pages dp ON dp.id = pie.page_id
       LEFT JOIN crawl_paths cp ON cp.interaction_element_id = pie.id
       WHERE dp.test_run_id = $1 AND cp.id IS NULL
       LIMIT 10`,
      [this.testRunId]
    );

    return result.rows;
  }

  /**
   * Generate page-level tests (placeholder - will be implemented next)
   */
  async generatePageTests(pageId, url, analysis, interactiveElements) {
    logger.info(`Generating page-level tests for: ${analysis.screenName}`);
    await this.pageTestGenerator.generateTests(
      this.testRunId,
      pageId,
      url,
      analysis,
      interactiveElements
    );
  }

  async generatePageTestsWithPrerequisites(pageId, url, analysis, interactiveElements, prerequisiteSteps) {
    logger.info(`Generating page-level tests with prerequisites for: ${analysis.screenName}`);
    logger.info(`  Prerequisite steps: ${prerequisiteSteps.length}`);

    await this.pageTestGenerator.generateTests(
      this.testRunId,
      pageId,
      url,
      analysis,
      interactiveElements
    );

    const cleanupSteps = [PathNavigator.createClearBrowserDataStep()];

    await pool.query(
      `UPDATE test_cases
       SET prerequisite_steps = $1, cleanup_steps = $2
       WHERE test_run_id = $3 AND page_id = $4`,
      [JSON.stringify(prerequisiteSteps), JSON.stringify(cleanupSteps), this.testRunId, pageId]
    );

    logger.info(`  ✅ Added prerequisite and cleanup steps to test cases`);
  }

  async discoverAndEnqueueLinks(page, pageId, currentUrl, analysis, depth, parentSteps) {
    if (depth + 1 > this.testConfig.max_depth) {
      logger.info(`  ⏭️ Skipping link discovery - max depth reached`);
      return;
    }

    const interactiveElements = analysis.interactiveElements || [];
    console.log('🔍 DEBUG: Total interactive elements:', interactiveElements.length);
    console.log('🔍 DEBUG: First 3 elements:', JSON.stringify(interactiveElements.slice(0, 3).map(el => ({
      element_type: el.element_type,
      text: el.text_content?.substring(0, 30),
      selector: el.selector,
      priority: el.interaction_priority
    })), null, 2));

    const navigableElements = interactiveElements.filter(el => {
      const elementType = el.element_type?.toLowerCase();
      const text = el.text_content?.toLowerCase() || '';

      if (elementType === 'link') return true;
      if (elementType === 'button') return true;
      if (elementType === 'tab') return true;
      if (elementType === 'menu-item') return true;
      if (text.includes('login') || text.includes('sign in') || text.includes('sign up') || text.includes('register')) return true;

      return false;
    });

    logger.info(`  🔗 Discovering URLs from ${navigableElements.length} navigable elements (out of ${interactiveElements.length} total)`);
    console.log('🔍 DEBUG: Navigable elements:', JSON.stringify(navigableElements.map(el => ({
      element_type: el.element_type,
      text: el.text_content?.substring(0, 20),
      selector: el.selector
    })), null, 2));

    for (const element of navigableElements) {
      if (this.pagesDiscovered >= this.testConfig.max_pages) {
        logger.info(`  ⏹️ Max pages reached, stopping link discovery`);
        break;
      }

      const selector = element.selector;
      const text = element.text_content || element.attributes?.['aria-label'] || 'unnamed';

      try {
        if (!selector) {
          logger.warn(`  ⚠️ Element has no selector: ${text}`);
          continue;
        }

        logger.info(`  👆 Clicking: ${text.substring(0, 50)} (${selector})`);

        const startUrl = page.url();

        await page.click(selector, { timeout: 5000 });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1000);

        const endUrl = page.url();

        if (endUrl !== startUrl && !this.visitedUrls.has(endUrl)) {
          logger.info(`    ✅ Discovered new URL: ${endUrl}`);

          const clickStep = PathNavigator.createClickStep(selector, text);
          const newSteps = PathNavigator.buildStepSequence(parentSteps, clickStep);

          await this.enqueueUrl(endUrl, depth + 1, pageId, null, 'medium', newSteps);
        } else if (endUrl === startUrl) {
          logger.info(`    ℹ️ Element stayed on same page (in-page action)`);
        } else {
          logger.info(`    ⏭️ Already visited: ${endUrl}`);
        }

        if (endUrl !== startUrl) {
          logger.info(`    ⬅️ Navigating back to: ${currentUrl}`);
          await page.goBack({ waitUntil: 'networkidle', timeout: 10000 }).catch(async () => {
            logger.warn(`    ⚠️ goBack failed, navigating directly`);
            await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 10000 });
          });
          await page.waitForTimeout(1000);
        }

      } catch (error) {
        logger.warn(`    ⚠️ Failed to click "${text.substring(0, 30)}": ${error.message}`);

        try {
          await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 10000 });
          await page.waitForTimeout(1000);
        } catch (navError) {
          logger.error(`    ❌ Failed to return to ${currentUrl}: ${navError.message}`);
          break;
        }
      }
    }

    logger.info(`  ✅ Link discovery complete`);
  }

  /**
   * Update stats during crawling (without changing status)
   */
  async updateRunningStats() {
    const testCasesCount = await pool.query(
      'SELECT COUNT(*) as count FROM test_cases WHERE test_run_id = $1',
      [this.testRunId]
    );

    const totalTestCases = parseInt(testCasesCount.rows[0].count) || 0;
    const coveragePercentage = Math.min((this.pagesDiscovered / this.testConfig.max_pages) * 100, 100);

    await pool.query(
      `UPDATE test_runs
       SET total_pages_discovered = $1,
           total_test_cases = $2,
           coverage_percentage = $3
       WHERE id = $4`,
      [this.pagesDiscovered, totalTestCases, coveragePercentage, this.testRunId]
    );
  }

  /**
   * Update test run statistics and mark as ready
   */
  async updateTestRunStats() {
    const testCasesCount = await pool.query(
      'SELECT COUNT(*) as count FROM test_cases WHERE test_run_id = $1',
      [this.testRunId]
    );

    const totalTestCases = parseInt(testCasesCount.rows[0].count) || 0;
    const coveragePercentage = Math.min((this.pagesDiscovered / this.testConfig.max_pages) * 100, 100);

    await pool.query(
      `UPDATE test_runs
       SET total_pages_discovered = $1,
           total_test_cases = $2,
           coverage_percentage = $3,
           status = 'ready_for_execution',
           end_time = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [this.pagesDiscovered, totalTestCases, coveragePercentage, this.testRunId]
    );

    logger.info(`Updated test run stats: ${this.pagesDiscovered} pages, ${totalTestCases} test cases, ${coveragePercentage.toFixed(2)}% coverage`);
  }

  /**
   * Pause the crawler
   */
  async pause() {
    logger.info('Pause requested for crawler');
    this.isPaused = true;

    await pool.query(
      `UPDATE test_runs SET status = 'paused' WHERE id = $1`,
      [this.testRunId]
    );

    if (this.io) {
      this.io.emit('crawlerProgress', {
        testRunId: this.testRunId,
        phase: 'paused',
        message: 'Crawling paused',
        discoveredPagesCount: this.pagesDiscovered
      });
    }
  }

  /**
   * Resume the crawler
   */
  async resume() {
    logger.info('Resume requested for crawler');
    this.isPaused = false;

    await pool.query(
      `UPDATE test_runs SET status = 'running' WHERE id = $1`,
      [this.testRunId]
    );

    if (this.io) {
      this.io.emit('crawlerProgress', {
        testRunId: this.testRunId,
        phase: 'crawling',
        message: 'Crawling resumed',
        discoveredPagesCount: this.pagesDiscovered
      });
    }
  }

  /**
   * Stop the crawler
   */
  async stop() {
    logger.info('Stop requested for crawler');
    this.shouldStop = true;
    this.isPaused = false;
    await this.updateTestRunStats();
  }

  /**
   * Cleanup resources
   */
  async handlePopupsAndModals(page) {
    try {
      logger.info('Checking for popups/modals');

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
      logger.debug(`Popup handling: ${error.message}`);
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
      '[data-dismiss="modal"]'
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
            return;
          }
        }
      } catch (error) {
        continue;
      }
    }

    // Try Escape key
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

  async smartClick(page, selector) {
    try {
      await page.click(selector, { timeout: 3000 });
      logger.info(`Clicked: ${selector}`);
      return true;
    } catch (error) {
      logger.warn(`Standard click failed, trying alternatives...`);

      try {
        await page.click(selector, { force: true, timeout: 3000 });
        logger.info(`Force-clicked: ${selector}`);
        return true;
      } catch (e) {
        try {
          await page.$eval(selector, el => el.click());
          logger.info(`JS-clicked: ${selector}`);
          await page.waitForTimeout(500);
          return true;
        } catch (e2) {
          throw new Error(`All click attempts failed for: ${selector}`);
        }
      }
    }
  }

  async smartFill(page, selector, value) {
    const initialDialogCount = await page.locator('[role="dialog"], [class*="modal"], [class*="dropdown"]').count();

    try {
      await page.click(selector, { timeout: 2000 });
      await page.waitForTimeout(500);
      logger.info(`Clicked field before filling: ${selector}`);
    } catch (e) {
      logger.debug(`Pre-click failed: ${e.message}`);
    }

    const newDialogCount = await page.locator('[role="dialog"], [class*="modal"], [class*="dropdown"], [class*="autocomplete"]').count();

    if (newDialogCount > initialDialogCount) {
      logger.info(`Field opened a search dialog/dropdown`);

      const dialogInput = page.locator('[role="dialog"] input, [class*="modal"] input, [class*="dropdown"] input, [class*="autocomplete"] input').first();
      const hasDialogInput = await dialogInput.count();

      if (hasDialogInput > 0) {
        try {
          await dialogInput.fill(value, { timeout: 3000 });
          logger.info(`Filled search dialog with: ${value}`);
          await page.waitForTimeout(1000);

          const firstOption = page.locator('[role="option"], [class*="option"], li[class*="item"]').first();
          const hasOption = await firstOption.count();
          if (hasOption > 0) {
            await firstOption.click({ timeout: 2000 }).catch(() => {});
            logger.info(`Selected first option from dialog`);
          }
          return true;
        } catch (e) {
          logger.debug(`Dialog fill failed: ${e.message}`);
        }
      }
    }

    try {
      await page.fill(selector, value, { timeout: 3000 });
      logger.info(`Filled: ${selector} = ${value}`);
      return true;
    } catch (e) {
      try {
        await page.click(selector, { timeout: 2000 });
        await page.type(selector, value, { delay: 50 });
        logger.info(`Typed: ${selector} = ${value}`);
        return true;
      } catch (e2) {
        throw new Error(`All fill attempts failed for: ${selector}`);
      }
    }
  }

  async smartSelect(page, selector, value) {
    try {
      await page.click(selector, { timeout: 2000 });
      await page.waitForTimeout(500);
      logger.info(`Clicked select element: ${selector}`);

      const options = page.locator('[role="option"], [class*="option"], li[class*="item"]');
      const optionCount = await options.count();

      if (optionCount > 0) {
        logger.info(`Custom select opened with ${optionCount} options`);
        if (value) {
          const matchingOption = options.filter({ hasText: value }).first();
          const hasMatch = await matchingOption.count();
          if (hasMatch > 0) {
            await matchingOption.click({ timeout: 2000 });
            logger.info(`Selected custom option: ${value}`);
            return true;
          }
        }
        await options.first().click({ timeout: 2000 });
        logger.info(`Selected first custom option`);
        return true;
      }
    } catch (e) {
      logger.debug(`Custom select handling failed: ${e.message}`);
    }

    try {
      if (value) {
        await page.selectOption(selector, value, { timeout: 3000 });
      } else {
        const optionElements = await page.$$(`${selector} option`);
        if (optionElements.length > 1) {
          await page.selectOption(selector, { index: 1 });
        }
      }
      logger.info(`Selected: ${selector} = ${value}`);
      return true;
    } catch (e) {
      throw new Error(`All select attempts failed for: ${selector}`);
    }
  }

  async cleanup() {
    try {
      if (this.browserPool) {
        await this.browserPool.closeAll();
        this.browserPool = null;
      }
      if (this.page) await this.page.close();
      if (this.context) await this.context.close();
      if (this.browser) await this.browser.close();
      logger.info('Browser cleanup completed');
    } catch (error) {
      logger.error(`Cleanup error: ${error.message}`);
    }
  }
}

module.exports = { AutonomousCrawler };
