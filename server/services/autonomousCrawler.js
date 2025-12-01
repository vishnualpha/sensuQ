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
const { decrypt } = require('../utils/encryption');

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
   * Check if we can enqueue URLs from the current depth
   * Enforces strict depth limit: pages at max_depth cannot discover new pages
   */
  canDiscoverFromDepth(currentDepth) {
    return currentDepth < this.testConfig.max_depth;
  }

  /**
   * Check if we can enqueue a URL at the target depth
   */
  canEnqueueAtDepth(targetDepth) {
    return targetDepth <= this.testConfig.max_depth;
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
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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

      // Let vision LLM identify popups/modals as interactive elements
      // Only auto-handle cookie consent as it blocks content
      try {
        await this.acceptCookies(this.page);
      } catch (cookieError) {
        logger.debug(`Cookie acceptance skipped: ${cookieError.message}`);
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

      // Ensure interactiveElements is always an array
      if (!analysis.interactiveElements || !Array.isArray(analysis.interactiveElements)) {
        logger.warn(`Vision LLM did not return valid interactiveElements, using empty array`);
        analysis.interactiveElements = [];
      }

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

      // Check if this is a login page and handle it (BEFORE generating scenarios)
      const isLoginPage = await this.detectLoginPage(this.page, analysis.pageType, analysis.screenName, analysis.interactiveElements);
      if (isLoginPage && this.testConfig.credentials) {
        logger.info(`🔐 Detected login page - attempting to authenticate`);
        const loginSuccess = await this.handleLoginForm(this.page, analysis.interactiveElements);

        if (loginSuccess) {
          logger.info(`✅ Login successful - continuing crawl as authenticated user`);

          // Wait for redirect after login
          await this.page.waitForTimeout(2000);
          const afterLoginUrl = this.page.url();

          if (afterLoginUrl !== url) {
            logger.info(`📍 Redirected to: ${afterLoginUrl}`);
            // Continue crawling from the post-login page
            // Don't enqueue - just continue with current flow
          }
        } else {
          logger.warn(`⚠️ Login attempt failed - continuing without authentication`);
        }
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
      // Only execute scenarios if we can discover from current depth
      if (this.canDiscoverFromDepth(depth)) {
        for (const scenario of scenarios) {
          if (!this.canDiscoverFromDepth(depth) || this.pagesDiscovered >= this.testConfig.max_pages) {
            break;
          }

          logger.info(`🎬 Executing scenario: "${scenario.name}"`);
          await this.executeScenario(scenario, pageId, depth);
        }
      } else {
        logger.info(`⏭️ Skipping scenario execution - page at max depth ${depth}`);
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

      // Wait for page to be fully loaded and ready
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Let vision LLM identify popups/modals as interactive elements
      // Only auto-handle cookie consent as it blocks content
      try {
        await this.acceptCookies(page);
      } catch (cookieError) {
        logger.debug(`Cookie acceptance skipped: ${cookieError.message}`);
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

      // Additional wait for dynamic content to fully render
      await page.waitForTimeout(1000);

      const screenshot = await page.screenshot({ fullPage: false });
      const screenshotBase64 = screenshot.toString('base64');
      const pageSource = await page.content();
      const title = await page.title();

      const analysis = await this.visionIdentifier.identifyInteractiveElements(
        screenshotBase64,
        pageSource,
        url
      );

      // Ensure interactiveElements is always an array
      if (!analysis.interactiveElements || !Array.isArray(analysis.interactiveElements)) {
        logger.warn(`Vision LLM did not return valid interactiveElements, using empty array`);
        analysis.interactiveElements = [];
      }

      logger.info(`Identified ${analysis.interactiveElements.length} interactive elements on ${analysis.screenName}`);

      if (analysis.interactiveElements.length === 0) {
        logger.warn(`⚠️ WARNING: No interactive elements found on ${url} - page may not be fully loaded`);
        logger.warn(`   Page title: ${title}`);
        logger.warn(`   HTML length: ${pageSource.length} chars`);
      }

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

      // Check if this is a login/auth page and handle it
      const isLoginPage = await this.detectLoginPage(page, analysis.pageType, analysis.screenName, analysis.interactiveElements);
      if (isLoginPage && this.testConfig.credentials) {
        logger.info(`🔐 Detected login page - attempting to authenticate`);
        const loginSuccess = await this.handleLoginForm(page, analysis.interactiveElements);

        if (loginSuccess) {
          logger.info(`✅ Login successful - continuing crawl as authenticated user`);

          // Wait for redirect after login
          await page.waitForTimeout(2000);
          const afterLoginUrl = page.url();

          if (afterLoginUrl !== url) {
            logger.info(`📍 Redirected to: ${afterLoginUrl}`);
            // Enqueue the post-login page for crawling
            const loginStep = PathNavigator.createFormFillStep(analysis.interactiveElements);
            const newSteps = PathNavigator.buildStepSequence(parentSteps, loginStep);
            await this.enqueueUrl(afterLoginUrl, depth + 1, pageId, null, 'high', newSteps);
          }
        } else {
          logger.warn(`⚠️ Login attempt failed - continuing without authentication`);
        }
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
        // Fill input with intelligent test data
        const testData = this.generateIntelligentTestData(selector, element.text_content, element.element_type);
        await this.page.fill(selector, testData);
        logger.info(`Filled input: ${selector} with: ${testData}`);
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

          // CRITICAL: After ANY action, detect if state changed (modal, dynamic fields, etc.)
          if (step.action === 'click' || step.action === 'fill') {
            logger.info(`  🔍 Checking for state changes after ${step.action}...`);

            // Wait for animations and state to settle
            await this.page.waitForTimeout(2000);

            const stateChange = await this.stateDetector.detectStateChange(
              this.page,
              i === 0 ? 'before_scenario' : `after_step_${i - 1}`,
              `after_step_${i}`,
              `${step.action} on ${step.textContent || step.selector}`
            );

            if (stateChange.significant) {
              logger.info(`  🎭 State change detected: ${stateChange.changes.changeType}`);
              logger.info(`  📝 ${stateChange.changes.description}`);

              // Handle modal opening
              if (stateChange.changes.changeType === 'modal_opened') {
                logger.info(`  🪟 Modal opened - checking contents...`);

                // If modal has login fields, attempt authentication
                if (stateChange.changes.details.hasPasswordField && this.testConfig.credentials) {
                  logger.info(`  🔐 Login modal detected - attempting authentication`);

                  // Re-analyze page to get modal elements
                  const screenshot = await this.page.screenshot({ encoding: 'base64', fullPage: false });
                  const pageSource = await this.page.content();
                  const currentUrl = this.page.url();

                  const updatedAnalysis = await this.visionIdentifier.identifyInteractiveElements(
                    screenshot,
                    pageSource,
                    currentUrl
                  );

                  if (!updatedAnalysis.interactiveElements || !Array.isArray(updatedAnalysis.interactiveElements)) {
                    updatedAnalysis.interactiveElements = [];
                  }

                  const loginSuccess = await this.handleLoginForm(this.page, updatedAnalysis.interactiveElements);

                  if (loginSuccess) {
                    logger.info(`  ✅ Login successful via modal`);
                    await this.page.waitForTimeout(2000);
                  } else {
                    logger.warn(`  ⚠️ Login attempt in modal failed`);
                  }
                } else {
                  // Modal opened but not a login modal - continue with scenario
                  logger.info(`  ℹ️ Non-login modal opened - continuing scenario`);
                }
              }

              // Handle dynamic fields appearing (multi-step forms)
              if (stateChange.changes.changeType === 'dynamic_fields' && stateChange.changes.details.newFields) {
                logger.info(`  📝 New form fields appeared: ${JSON.stringify(stateChange.changes.details.newFields)}`);
                // The new fields will be handled in subsequent steps if LLM generated them
              }

              // Handle login form appearing inline (not in modal)
              if (stateChange.changes.changeType === 'login_form_appeared' && this.testConfig.credentials) {
                logger.info(`  🔐 Login form appeared inline - attempting authentication`);

                const screenshot = await this.page.screenshot({ encoding: 'base64', fullPage: false });
                const pageSource = await this.page.content();
                const currentUrl = this.page.url();

                const updatedAnalysis = await this.visionIdentifier.identifyInteractiveElements(
                  screenshot,
                  pageSource,
                  currentUrl
                );

                if (!updatedAnalysis.interactiveElements || !Array.isArray(updatedAnalysis.interactiveElements)) {
                  updatedAnalysis.interactiveElements = [];
                }

                const loginSuccess = await this.handleLoginForm(this.page, updatedAnalysis.interactiveElements);

                if (loginSuccess) {
                  logger.info(`  ✅ Login successful`);
                  await this.page.waitForTimeout(2000);
                }
              }
            }
          }

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

        // Wait for element to be visible with longer timeout for dynamic content
        const isVisible = await locator.first().isVisible().catch(() => false);
        if (!isVisible) {
          throw new Error(`Element with text "${textContent}" not visible`);
        }

        return await this.executeStepWithLocator(step, locator.first());
      }
    }

    // Try the provided selector first - use locator for better visibility checking
    try {
      const element = this.page.locator(selector).first();

      // Wait for element to exist in DOM with extended timeout for dynamic content
      await element.waitFor({ state: 'attached', timeout: 8000 }).catch(() => {
        throw new Error('Element not found in DOM');
      });

      // Wait for element to be visible with extended timeout
      await element.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
        throw new Error('Element exists but not visible');
      });

      logger.info(`  ✅ Element is visible and ready: ${selector}`);

    } catch (e) {
      logger.warn(`Selector not found or not visible: ${selector} - ${e.message}`);

      // Try to find by text content if available
      if (step.textContent && step.textContent.length > 0) {
        logger.info(`Attempting to find element by text: "${step.textContent}"`);

        // Try various text-based fallback strategies
        const alternatives = [
          `text="${step.textContent}"`,
          `${step.elementType}:has-text("${step.textContent}")`,
          `input[placeholder*="${step.textContent}" i]`,
          `[aria-label*="${step.textContent}" i]`,
          `[title*="${step.textContent}" i]`
        ];

        for (const altSelector of alternatives) {
          try {
            const locator = this.page.locator(altSelector).first();

            // Wait for element with this alternative selector
            await locator.waitFor({ state: 'visible', timeout: 3000 });

            logger.info(`✅ Found element using alternative: ${altSelector}`);
            return await this.executeStepWithLocator(step, locator);
          } catch (e2) {
            // Try next alternative
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
        let fillValue = step.value;

        // Handle credential placeholders
        if (fillValue === '{auth_username}' && this.testConfig.auth_username) {
          logger.info(`Substituting {auth_username} with configured username`);
          fillValue = this.testConfig.auth_username;
        } else if (fillValue === '{auth_password}' && this.testConfig.auth_password) {
          logger.info(`Substituting {auth_password} with configured password`);
          fillValue = this.testConfig.auth_password;
        } else if (fillValue === '{auth_username}' || fillValue === '{auth_password}') {
          logger.warn(`Placeholder ${fillValue} found but no credentials configured!`);
        }

        // If no value provided, generate intelligent test data based on field attributes
        if (!fillValue) {
          fillValue = this.generateIntelligentTestData(selector, step.textContent, step.elementType);
          logger.info(`Generated intelligent test data for ${selector}: ${fillValue}`);
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
      // Strict depth check: don't enqueue if target depth exceeds max_depth
      if (!this.canEnqueueAtDepth(depth)) {
        logger.info(`⏭️ Skipping enqueue of ${url} - depth ${depth} exceeds max_depth ${this.testConfig.max_depth}`);
        return;
      }

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

      // Pass credentials to PathNavigator for auth placeholder substitution
      const credentials = this.testConfig.credentials ? (() => {
        try {
          const decrypted = decrypt(this.testConfig.credentials);
          const parsed = JSON.parse(decrypted);
          return {
            username: parsed.username || parsed.email || this.testConfig.auth_username,
            password: parsed.password || this.testConfig.auth_password
          };
        } catch (error) {
          logger.warn(`Failed to decrypt credentials for PathNavigator: ${error.message}`);
          return null;
        }
      })() : null;

      const navigator = new PathNavigator(browser.page, credentials);

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
    // Check if current page is at a depth that can discover new pages
    if (!this.canDiscoverFromDepth(depth)) {
      logger.info(`  ⏭️ Skipping link discovery - page at depth ${depth} (max_depth: ${this.testConfig.max_depth})`);
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
      if (elementType === 'a') return true;
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

    let elementIndex = 0;
    for (const element of navigableElements) {
      elementIndex++;
      logger.info(`\n  [${elementIndex}/${navigableElements.length}] Processing element...`);
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

        const clicked = await this.clickElementWithHealing(page, selector, text, element);
        if (!clicked) {
          logger.warn(`    ❌ Could not click element even with self-healing, skipping`);
          continue;
        }

        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // WAIT LONGER for modal animations
        logger.info(`    ⏳ Waiting 3 seconds for potential modal to fully render...`);
        await page.waitForTimeout(3000);

        const endUrl = page.url();

        // CRITICAL: Check if clicking opened a login modal (URL stays the same but modal appears)
        if (endUrl === startUrl && this.testConfig.credentials) {
          logger.info(`    🔎 Checking for login modal after clicking "${text}"...`);
          logger.info(`    URL stayed same: ${startUrl}, has credentials: ${!!this.testConfig.credentials}`);

          // Check for ANY input fields that might be password fields
          const allInputs = await page.$$('input');
          logger.info(`    Total input elements on page: ${allInputs.length}`);

          // Check for modals/dialogs
          const modalCount = await page.locator('[role="dialog"], [class*="modal"], [class*="Modal"]').count();
          logger.info(`    Modal/dialog elements: ${modalCount}`);

          // AGGRESSIVE CHECK: Check if password field EXISTS in HTML (regardless of visibility)
          const passwordFieldCount = await page.locator('input[type="password"]').count();
          logger.info(`    Password field count in HTML: ${passwordFieldCount}`);

          // If password field exists in HTML, wait for it to become visible
          let hasPasswordField = false;
          if (passwordFieldCount > 0) {
            logger.info(`    🎯 Password field found in HTML - waiting for it to become visible...`);

            try {
              // Wait up to 5 seconds for password field to become visible
              await page.locator('input[type="password"]').first().waitFor({
                state: 'visible',
                timeout: 5000
              });
              hasPasswordField = true;
              logger.info(`    ✅ Password field is now visible!`);
            } catch (waitError) {
              logger.warn(`    ⚠️ Password field exists in HTML but did not become visible within 5s: ${waitError.message}`);

              // Try checking if it's attached and enabled even if not "visible"
              const isAttached = await page.locator('input[type="password"]').first().isAttached().catch(() => false);
              const isEnabled = await page.locator('input[type="password"]').first().isEnabled().catch(() => false);
              logger.info(`    Password field attached: ${isAttached}, enabled: ${isEnabled}`);

              // If it's attached and enabled, treat it as usable even if not "visible"
              if (isAttached && isEnabled) {
                logger.info(`    🔓 Password field is attached and enabled - will attempt to use it`);
                hasPasswordField = true;
              }
            }
          } else {
            logger.info(`    ℹ️ No password field found in HTML after clicking`);
          }

          if (hasPasswordField) {
            logger.info(`    🔍 Password field detected after clicking "${text}" - checking for login form...`);

            // Re-analyze page to get current interactive elements (including modal)
            const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
            const pageSource = await page.content();

            const updatedAnalysis = await this.visionIdentifier.identifyInteractiveElements(
              screenshot,
              pageSource,
              endUrl
            );

            // Ensure interactiveElements is always an array
            if (!updatedAnalysis.interactiveElements || !Array.isArray(updatedAnalysis.interactiveElements)) {
              updatedAnalysis.interactiveElements = [];
            }

            // Check if a login form is now visible
            const isLoginVisible = await this.detectLoginPage(
              page,
              updatedAnalysis.pageType,
              updatedAnalysis.screenName,
              updatedAnalysis.interactiveElements
            );

            if (isLoginVisible) {
              logger.info(`    🔐 Login modal detected during link discovery - attempting authentication`);
              const loginSuccess = await this.handleLoginForm(page, updatedAnalysis.interactiveElements);

              if (loginSuccess) {
                logger.info(`    ✅ Login successful via modal during link discovery`);
                await page.waitForTimeout(2000); // Wait for post-login redirect/state change

                // Check if login redirected us to a new page
                const afterLoginUrl = page.url();
                if (afterLoginUrl !== startUrl && !this.visitedUrls.has(afterLoginUrl)) {
                  logger.info(`    🎯 Login redirected to new page: ${afterLoginUrl}`);
                  const clickStep = PathNavigator.createClickStep(selector, text);
                  const newSteps = PathNavigator.buildStepSequence(parentSteps, clickStep);
                  await this.enqueueUrl(afterLoginUrl, depth + 1, pageId, null, 'high', newSteps);
                  continue; // Skip the navigation back, we're on a new page
                }
              } else {
                logger.warn(`    ⚠️ Login attempt in modal failed during link discovery`);
              }
            }
          }
        }

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

          try {
            await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 10000 });
            await page.waitForTimeout(1500);

            // Verify we're back on the correct page
            const backUrl = page.url();
            if (backUrl !== currentUrl) {
              logger.warn(`    ⚠️ goBack went to ${backUrl}, expected ${currentUrl}. Navigating directly.`);
              await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 10000 });
              await page.waitForTimeout(1500);
            }

            // Double-check we're on the right page
            const finalUrl = page.url();
            if (finalUrl === currentUrl) {
              logger.info(`    ✅ Successfully returned to ${currentUrl} - continuing with remaining ${navigableElements.length - (navigableElements.indexOf(element) + 1)} elements`);
            } else {
              logger.error(`    ❌ Still on wrong page: ${finalUrl} (expected ${currentUrl})`);
            }
          } catch (backError) {
            logger.warn(`    ⚠️ goBack failed: ${backError.message}. Navigating directly.`);
            try {
              await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 10000 });
              await page.waitForTimeout(1500);
              const finalUrl = page.url();
              logger.info(`    ✅ Direct navigation to ${finalUrl} successful`);
            } catch (navError) {
              logger.error(`    ❌ Failed to return to ${currentUrl}: ${navError.message}`);
              logger.error(`    🛑 Cannot continue with remaining elements on this page`);
              break;
            }
          }
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
   * Detect if this is a login/authentication page
   * Works language-independently by focusing on input types and form structure
   * IMPORTANT: Only detects login if password field is VISIBLE on the page
   */
  async detectLoginPage(page, pageType, screenName, elements) {
    const pageTypeLower = (pageType || '').toString().toLowerCase();
    const screenNameLower = (screenName || '').toString().toLowerCase();

    // Safety check: ensure elements is an array
    if (!elements || !Array.isArray(elements)) {
      logger.warn(`detectLoginPage: elements is not an array: ${typeof elements}`);
      return false;
    }

    // Language-independent detection: Look for password field (most reliable)
    const passwordElements = elements.filter(el =>
      el.element_type === 'input' &&
      (el.attributes?.type === 'password' ||
       el.attributes?.name?.toLowerCase().includes('pass') ||
       el.attributes?.id?.toLowerCase().includes('pass'))
    );

    // If no password field elements found in HTML, definitely not a login form
    if (passwordElements.length === 0) {
      return false;
    }

    // CRITICAL: Check if ANY password field is actually VISIBLE on the page
    let hasVisiblePasswordField = false;
    for (const pwdEl of passwordElements) {
      try {
        const isVisible = await page.locator(pwdEl.selector).isVisible({ timeout: 1000 });
        if (isVisible) {
          hasVisiblePasswordField = true;
          logger.info(`  ✅ Found visible password field: ${pwdEl.selector}`);
          break;
        }
      } catch (e) {
        // Element not found or not visible, continue checking others
        continue;
      }
    }

    if (!hasVisiblePasswordField) {
      logger.info(`  ⏭️ Password fields found in HTML but none are visible - not a login page`);
      return false;
    }

    // Check page type and screen name (supports English keywords)
    if (pageTypeLower.includes('login') || pageTypeLower.includes('auth') ||
        pageTypeLower.includes('signin') || pageTypeLower.includes('sign-in') ||
        screenNameLower.includes('login') || screenNameLower.includes('sign in')) {
      logger.info(`  ✅ Login page detected by page type/screen name`);
      return true;
    }

    // Look for text/email input field (language-independent)
    const hasTextInput = elements.some(el =>
      el.element_type === 'input' &&
      (el.attributes?.type === 'email' ||
       el.attributes?.type === 'text' ||
       el.attributes?.name?.toLowerCase().includes('user') ||
       el.attributes?.name?.toLowerCase().includes('email') ||
       el.attributes?.name?.toLowerCase().includes('login') ||
       el.attributes?.id?.toLowerCase().includes('user') ||
       el.attributes?.id?.toLowerCase().includes('email'))
    );

    // Look for any submit button or button element
    const hasSubmitButton = elements.some(el =>
      (el.element_type === 'button' ||
       el.element_type === 'input' && el.attributes?.type === 'submit') ||
      (el.attributes?.type === 'submit')
    );

    // Login form = visible password field + text input + button
    const isLoginForm = hasVisiblePasswordField && hasTextInput && hasSubmitButton;

    if (isLoginForm) {
      logger.info(`🔐 Login form detected: password=${hasVisiblePasswordField}, text=${hasTextInput}, submit=${hasSubmitButton}`);
    }

    return isLoginForm;
  }

  /**
   * Attempt to fill and submit a login form
   * Works language-independently by using input types and attributes
   * IMPORTANT: Only uses VISIBLE elements to avoid interacting with hidden forms
   */
  async handleLoginForm(page, elements) {
    try {
      // Decrypt and parse credentials
      const credentials = JSON.parse(decrypt(this.testConfig.credentials));

      // Safety check: ensure elements is an array
      if (!elements || !Array.isArray(elements)) {
        logger.error(`handleLoginForm: elements is not an array: ${typeof elements}`);
        return false;
      }

      // STEP 1: Filter to only VISIBLE elements to avoid hidden forms
      logger.info(`  🔍 Filtering ${elements.length} elements to only visible ones...`);
      const visibleElements = [];

      for (const el of elements) {
        try {
          const isVisible = await page.locator(el.selector).isVisible({ timeout: 1000 });
          if (isVisible) {
            visibleElements.push(el);
          }
        } catch (e) {
          // Element not found or not visible, skip it
          continue;
        }
      }

      logger.info(`  ✅ Found ${visibleElements.length} visible elements (filtered from ${elements.length})`);

      // STEP 2: Find password field from VISIBLE elements only
      const passwordField = visibleElements.find(el =>
        el.element_type === 'input' &&
        (el.attributes?.type === 'password' ||
         el.attributes?.name?.toLowerCase().includes('pass') ||
         el.attributes?.id?.toLowerCase().includes('pass'))
      );

      // STEP 3: Find username/email field from VISIBLE elements only
      const usernameField = visibleElements.find(el =>
        el.element_type === 'input' &&
        (el.attributes?.type === 'email' ||
         el.attributes?.type === 'text' ||
         el.attributes?.name?.toLowerCase().includes('user') ||
         el.attributes?.name?.toLowerCase().includes('email') ||
         el.attributes?.name?.toLowerCase().includes('login') ||
         el.attributes?.id?.toLowerCase().includes('user') ||
         el.attributes?.id?.toLowerCase().includes('email'))
      );

      // STEP 4: Find submit button from VISIBLE elements only
      // Prefer type=submit, then any button element
      let submitButton = visibleElements.find(el =>
        (el.element_type === 'input' && el.attributes?.type === 'submit') ||
        (el.element_type === 'button' && el.attributes?.type === 'submit')
      );

      // If no submit type, just find any button near the form
      if (!submitButton) {
        submitButton = visibleElements.find(el => el.element_type === 'button');
      }

      if (!usernameField || !passwordField) {
        logger.warn(`Missing visible login form fields: username=${!!usernameField}, password=${!!passwordField}, submit=${!!submitButton}`);
        return false;
      }

      logger.info(`  📝 Found visible login fields:`);
      logger.info(`     Username: ${usernameField.selector} (${usernameField.attributes?.name || usernameField.attributes?.id || 'no-name'})`);
      logger.info(`     Password: ${passwordField.selector} (${passwordField.attributes?.name || passwordField.attributes?.id || 'no-name'})`);
      if (submitButton) {
        logger.info(`     Submit: ${submitButton.selector} (${submitButton.text_content || 'no-text'})`);
      }

      // Fill username
      logger.info(`  📝 Filling username field with configured credentials`);
      await this.smartFill(page, usernameField.selector, credentials.username || credentials.email || this.testConfig.auth_username);

      await page.waitForTimeout(800);

      // Fill password
      logger.info(`  📝 Filling password field with configured credentials`);
      await this.smartFill(page, passwordField.selector, credentials.password || this.testConfig.auth_password);

      await page.waitForTimeout(800);

      // Submit form
      if (submitButton) {
        logger.info(`  🖱️ Clicking submit button`);
        await Promise.all([
          page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}),
          this.smartClick(page, submitButton.selector)
        ]);
      } else {
        // No button found - try pressing Enter on password field
        logger.info(`  ⌨️ No submit button found - pressing Enter on password field`);
        await page.locator(passwordField.selector).press('Enter');
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      }

      await page.waitForTimeout(3000);

      // Check if login was successful
      const currentUrl = page.url();

      // Check for password field still visible (login failed)
      const passwordStillVisible = await page.locator('input[type="password"]').isVisible().catch(() => false);

      if (!passwordStillVisible) {
        logger.info(`  ✅ Login successful - password field no longer visible`);
        return true;
      } else {
        logger.warn(`  ⚠️ Login may have failed - password field still visible`);
        return false;
      }

    } catch (error) {
      logger.error(`Login form handling failed: ${error.message}`);
      return false;
    }
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
   * Handle popups/modals - DEPRECATED: Only kept for cookie consent
   * Let LLM identify and handle login modals, dialogs, etc. naturally
   */
  async handlePopupsAndModals(page) {
    try {
      logger.info('Minimal popup handling - cookies only');

      // Wait a moment for popups to appear
      await page.waitForTimeout(1500);

      // Only accept cookies automatically (they block content)
      await this.acceptCookies(page);

      logger.info('Completed minimal popup handling');
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
    try {
      // First check if there's a login form visible - if so, don't touch cookies yet
      const hasVisiblePasswordField = await page.locator('input[type="password"]').isVisible().catch(() => false);
      if (hasVisiblePasswordField) {
        logger.info(`⏭️ Skipping cookie acceptance - login form is visible`);
        return;
      }

      const cookieSelectors = [
        'button:has-text("Accept All")',
        'button:has-text("Accept")',
        'button:has-text("Allow All")',
        'button:has-text("OK")',
        '[class*="cookie"] button:has-text("Accept")',
        '[id*="cookie-accept"]',
        '[id*="cookie"] button[type="button"]'
      ];

      for (const selector of cookieSelectors) {
        try {
          const element = await page.locator(selector).first();
          const count = await element.count();

          if (count > 0) {
            const isVisible = await element.isVisible().catch(() => false);
            if (isVisible) {
              // Check if this button is inside a modal with a form
              const parentModal = await element.locator('xpath=ancestor::*[contains(@class, "modal") or contains(@role, "dialog")]').count();
              const hasFormInModal = parentModal > 0 && await page.locator('input[type="password"]').count() > 0;

              if (hasFormInModal) {
                logger.info(`⏭️ Skipping cookie button - it's in a modal with a login form`);
                continue;
              }

              await element.click({ timeout: 2000 }).catch(() => {});
              logger.info(`🍪 Accepted cookies using: ${selector}`);
              await page.waitForTimeout(1000);
              return;
            }
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      logger.debug(`Cookie acceptance skipped: ${error.message}`);
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

  /**
   * Generate intelligent test data based on field selector, text content, and type
   * Uses field attributes to determine appropriate test data
   */
  generateIntelligentTestData(selector, textContent, elementType) {
    const selectorLower = (selector || '').toLowerCase();
    const textLower = (textContent || '').toLowerCase();
    const combined = selectorLower + ' ' + textLower;

    // Email fields
    if (combined.includes('email') || combined.includes('e-mail')) {
      return 'test@example.com';
    }

    // Password fields
    if (combined.includes('password') || combined.includes('pwd') || combined.includes('pass')) {
      return 'TestPassword123!';
    }

    // Name fields
    if (combined.includes('firstname') || combined.includes('first_name') || combined.includes('fname')) {
      return 'John';
    }
    if (combined.includes('lastname') || combined.includes('last_name') || combined.includes('lname')) {
      return 'Doe';
    }
    if (combined.includes('fullname') || combined.includes('full_name') || combined.includes('name')) {
      return 'John Doe';
    }

    // Phone fields
    if (combined.includes('phone') || combined.includes('mobile') || combined.includes('tel')) {
      return '+1-555-0123';
    }

    // Address fields
    if (combined.includes('address') || combined.includes('street')) {
      return '123 Main Street';
    }
    if (combined.includes('city')) {
      return 'New York';
    }
    if (combined.includes('zip') || combined.includes('postal')) {
      return '10001';
    }
    if (combined.includes('country')) {
      return 'United States';
    }

    // Date fields
    if (combined.includes('date') || combined.includes('dob') || combined.includes('birthday')) {
      return '1990-01-15';
    }

    // Age/Number fields
    if (combined.includes('age')) {
      return '25';
    }
    if (combined.includes('quantity') || combined.includes('qty') || combined.includes('amount')) {
      return '10';
    }

    // URL fields
    if (combined.includes('url') || combined.includes('website')) {
      return 'https://example.com';
    }

    // Search fields
    if (combined.includes('search') || combined.includes('query')) {
      return 'test search';
    }

    // Company/Organization
    if (combined.includes('company') || combined.includes('organization')) {
      return 'Test Company Inc';
    }

    // Username
    if (combined.includes('username') || combined.includes('user_name')) {
      return 'testuser123';
    }

    // Message/Comment/Description fields (textarea)
    if (elementType === 'textarea' || combined.includes('message') || combined.includes('comment') || combined.includes('description') || combined.includes('notes')) {
      return 'This is a test message for form validation and submission testing.';
    }

    // Generic text input - use a generic but meaningful value
    if (elementType === 'input') {
      return 'Test Input';
    }

    // Default fallback
    return 'Test Data';
  }

  async smartClick(page, selector) {
    // CRITICAL: Check if element is actually clickable (not behind a modal/overlay)
    try {
      const element = page.locator(selector).first();

      // Wait for element to be attached and visible with extended timeout for dynamic content
      await element.waitFor({ state: 'visible', timeout: 8000 });

      // Check if element is enabled
      const isEnabled = await element.isEnabled().catch(() => true);
      if (!isEnabled) {
        logger.warn(`Element is disabled but will attempt click: ${selector}`);
      }

      // Scroll element into view if needed
      await element.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {
        logger.debug(`Could not scroll element into view: ${selector}`);
      });

      // Try normal click first (respects overlays)
      await element.click({ timeout: 5000 });
      logger.info(`✅ Clicked: ${selector}`);
      return true;
    } catch (error) {
      logger.warn(`Standard click failed: ${error.message}, trying alternatives...`);

      try {
        // Force click (ignores overlays) - use with caution
        await page.click(selector, { force: true, timeout: 3000 });
        logger.info(`⚠️ Force-clicked: ${selector}`);
        return true;
      } catch (e) {
        try {
          // JS click as last resort
          await page.$eval(selector, el => el.click());
          logger.info(`⚠️ JS-clicked: ${selector}`);
          await page.waitForTimeout(500);
          return true;
        } catch (e2) {
          throw new Error(`All click attempts failed for: ${selector}`);
        }
      }
    }
  }

  async smartFill(page, selector, value) {
    // CRITICAL: First verify the element is actually visible
    try {
      const element = page.locator(selector).first();

      // Wait for element with extended timeout for dynamic forms
      await element.waitFor({ state: 'visible', timeout: 8000 });

      logger.info(`✅ Verified element is visible: ${selector}`);
    } catch (e) {
      logger.error(`Element not visible before fill: ${e.message}`);
      throw new Error(`Cannot fill - element not visible: ${selector}`);
    }

    const initialDialogCount = await page.locator('[role="dialog"], [class*="modal"], [class*="dropdown"]').count();

    // Click the field to focus it (but ensure we're clicking the visible one)
    try {
      const element = await page.locator(selector).first();
      await element.click({ timeout: 2000 });
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

    // Try to fill using locator (respects visibility)
    try {
      const element = await page.locator(selector).first();
      await element.fill(value, { timeout: 3000 });
      logger.info(`Filled: ${selector} = ${value}`);
      return true;
    } catch (e) {
      logger.warn(`Direct fill failed: ${e.message}, trying type...`);

      // Fallback to click + type
      try {
        const element = await page.locator(selector).first();
        await element.click({ timeout: 2000 });
        await element.clear({ timeout: 1000 }).catch(() => {}); // Clear first
        await page.type(selector, value, { delay: 50 });
        logger.info(`Typed: ${selector} = ${value}`);
        return true;
      } catch (e2) {
        throw new Error(`All fill attempts failed for: ${selector}`);
      }
    }
  }

  async smartSelect(page, selector, value) {
    // CRITICAL: First verify the element is actually visible
    try {
      const element = await page.locator(selector).first();
      const isVisible = await element.isVisible({ timeout: 3000 });

      if (!isVisible) {
        throw new Error(`Element not visible: ${selector}`);
      }

      logger.info(`✅ Verified select element is visible: ${selector}`);
    } catch (e) {
      logger.error(`Element not visible before select: ${e.message}`);
      throw new Error(`Cannot select - element not visible: ${selector}`);
    }

    // Try custom dropdown/select component
    try {
      const element = await page.locator(selector).first();
      await element.click({ timeout: 2000 });
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

    // Try standard HTML select
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

  /**
   * Click element with self-healing fallback
   * Tries original selector, then attempts to find element by text/attributes
   */
  async clickElementWithHealing(page, selector, text, element) {
    try {
      // Check if selector matches multiple elements
      const count = await page.locator(selector).count();

      if (count > 1 && text) {
        // Non-unique selector! Use text-based selector instead
        logger.warn(`    ⚠️ Selector matches ${count} elements, using text-based selector`);
        const textSelector = `${element.element_type}:has-text("${text.trim()}")`;
        const textCount = await page.locator(textSelector).count();

        if (textCount === 1) {
          await page.click(textSelector, { timeout: 5000 });
          logger.info(`    ✅ Clicked using text selector: ${textSelector}`);
          element.selector = textSelector;
          return true;
        } else if (textCount > 1) {
          // Multiple elements with same text, try exact text match
          const exactSelector = `${element.element_type}:text-is("${text.trim()}")`;
          const exactCount = await page.locator(exactSelector).count();

          if (exactCount >= 1) {
            await page.locator(exactSelector).first().click({ timeout: 5000 });
            logger.info(`    ✅ Clicked first match of exact text: ${exactSelector}`);
            element.selector = exactSelector;
            return true;
          }
        }
      }

      // Try original selector
      await page.click(selector, { timeout: 5000 });
      logger.info(`    ✅ Clicked using original selector`);
      return true;
    } catch (error) {
      logger.warn(`    🔧 Original selector failed, attempting self-healing...`);

      try {
        const healedSelector = await this.findAlternativeSelector(page, text, element);
        if (healedSelector) {
          await page.click(healedSelector, { timeout: 5000 });
          logger.info(`    ✅ Self-healed! Clicked using: ${healedSelector}`);

          element.selector = healedSelector;
          element.selfHealed = true;

          return true;
        }
      } catch (healError) {
        logger.warn(`    ❌ Self-healing failed: ${healError.message}`);
      }

      return false;
    }
  }

  /**
   * Find alternative selector for an element
   * Uses text content and attributes to locate the element
   */
  async findAlternativeSelector(page, text, element) {
    const attrs = element.attributes || {};

    const strategies = [
      () => text ? `text="${text.trim()}"` : null,
      () => attrs['aria-label'] ? `[aria-label="${attrs['aria-label']}"]` : null,
      () => attrs['data-testid'] ? `[data-testid="${attrs['data-testid']}"]` : null,
      () => attrs.name ? `[name="${attrs.name}"]` : null,
      () => attrs.role && text ? `[role="${attrs.role}"] >> text="${text.trim()}"` : null,
      () => attrs.type && text ? `${element.element_type}[type="${attrs.type}"] >> text="${text.trim()}"` : null,
      () => text && text.trim().length > 3 ? `${element.element_type}:has-text("${text.trim().substring(0, 30)}")` : null,
    ];

    for (const strategy of strategies) {
      const candidateSelector = strategy();
      if (!candidateSelector) continue;

      try {
        const count = await page.locator(candidateSelector).count();
        if (count === 1) {
          const isVisible = await page.locator(candidateSelector).isVisible();
          if (isVisible) {
            logger.info(`    💡 Found alternative: ${candidateSelector}`);
            return candidateSelector;
          }
        } else if (count > 1) {
          logger.warn(`    ⚠️ Multiple matches for: ${candidateSelector}`);
        }
      } catch (e) {
      }
    }

    return null;
  }
}

module.exports = { AutonomousCrawler };
