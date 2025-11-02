const { chromium } = require('playwright');
const logger = require('../utils/logger');
const { VisionElementIdentifier } = require('./visionElementIdentifier');
const { PageLevelTestGenerator } = require('./pageLevelTestGenerator');
const { FlowLevelTestGenerator } = require('./flowLevelTestGenerator');
const IntelligentInteractionPlanner = require('./intelligentInteractionPlanner');
const SPAStateDetector = require('./spaStateDetector');
const { pool } = require('../config/database');

/**
 * Autonomous crawler that uses vision LLM to identify and interact with elements
 */
class AutonomousCrawler {
  constructor(testRunId, testConfig, llmConfig, io = null) {
    this.testRunId = testRunId;
    this.testConfig = testConfig;
    this.llmConfig = llmConfig;
    this.io = io;
    this.visionIdentifier = new VisionElementIdentifier(llmConfig);
    this.pageTestGenerator = new PageLevelTestGenerator(llmConfig);
    this.flowTestGenerator = new FlowLevelTestGenerator(llmConfig);
    this.interactionPlanner = new IntelligentInteractionPlanner(llmConfig);
    this.stateDetector = new SPAStateDetector();

    this.browser = null;
    this.context = null;
    this.page = null;

    this.visitedUrls = new Set();
    this.crawlPaths = [];
    this.shouldStop = false;
    this.isPaused = false;
    this.currentDepth = 0;
    this.pagesDiscovered = 0;
    this.pathSequence = 0;
    this.virtualPageCounter = 0;
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
      await this.initializeBrowser();

      await this.enqueueUrl(this.testConfig.target_url, 0, null, null, 'high');

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
          canStopCrawling: this.pagesDiscovered > 0,
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
          scenarioSuccess = false;
          break;
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
      // Try to find element by text content as fallback
      const textMatch = selector.match(/:has-text\("([^"]+)"\)/);
      if (textMatch) {
        const textContent = textMatch[1];
        logger.warn(`Invalid selector syntax detected: ${selector}`);
        logger.info(`Attempting to find element by text: "${textContent}"`);

        // Try to find the element using text content
        const locator = this.page.locator(`text="${textContent}"`);
        const count = await locator.count();

        if (count === 0) {
          throw new Error(`Element with text "${textContent}" not found`);
        }

        // Use the first match
        const isVisible = await locator.first().isVisible();
        if (!isVisible) {
          throw new Error(`Element with text "${textContent}" not visible`);
        }

        // Perform action using locator instead of selector
        return await this.executeStepWithLocator(step, locator.first());
      }
    }

    await this.page.waitForSelector(selector, { timeout: 5000 });

    const isVisible = await this.page.isVisible(selector);
    if (!isVisible) {
      throw new Error(`Element not visible: ${selector}`);
    }

    switch (step.action) {
      case 'click':
        await Promise.all([
          this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}),
          this.page.click(selector)
        ]);
        break;

      case 'fill':
        let fillValue = step.value || 'test data';

        if (fillValue === '{auth_username}' && this.testConfig.auth_username) {
          fillValue = this.testConfig.auth_username;
        } else if (fillValue === '{auth_password}' && this.testConfig.auth_password) {
          fillValue = this.testConfig.auth_password;
        }

        await this.page.fill(selector, fillValue);
        break;

      case 'select':
        const options = await this.page.$$eval(`${selector} option`, opts => opts.map(o => o.value));
        const valueToSelect = step.value || (options.length > 1 ? options[1] : options[0]);
        await this.page.selectOption(selector, valueToSelect);
        break;

      case 'check':
        await this.page.check(selector);
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
          fillValue = this.testConfig.auth_username;
        } else if (fillValue === '{auth_password}' && this.testConfig.auth_password) {
          fillValue = this.testConfig.auth_password;
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
   * Enqueue a URL for breadth-first crawling
   */
  async enqueueUrl(url, depth, fromPageId, scenarioId, priority = 'medium') {
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
         (test_run_id, url, depth_level, from_page_id, scenario_id, priority, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'queued')`,
        [this.testRunId, url, depth, fromPageId, scenarioId, priority]
      );

      logger.info(`📥 Enqueued: ${url} (depth: ${depth}, priority: ${priority})`);
    } catch (error) {
      logger.error(`Failed to enqueue URL ${url}: ${error.message}`);
    }
  }

  /**
   * Process the queue using breadth-first strategy
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

      for (const item of queueItems.rows) {
        // Check for pause
        while (this.isPaused && !this.shouldStop) {
          logger.info('Crawler is paused. Waiting...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Check for stop
        if (this.shouldStop) {
          logger.info('Stop requested, exiting crawl loop');
          break;
        }

        if (this.pagesDiscovered >= this.testConfig.max_pages) {
          logger.info(`Reached max pages limit (${this.testConfig.max_pages})`);
          break;
        }

        await this.processQueueItem(item);
        processedCount++;
      }

      currentDepth++;
    }

    logger.info(`✅ Queue processing complete. Processed ${processedCount} items.`);
  }

  /**
   * Process a single queue item
   */
  async processQueueItem(item) {
    try {
      await pool.query(
        `UPDATE page_discovery_queue
         SET status = 'processing', started_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [item.id]
      );

      logger.info(`\n🌐 [Depth ${item.depth_level}] Crawling: ${item.url}`);

      await this.crawlPage(item.url, item.from_page_id, null, item.depth_level);

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

    const result = await pool.query(
      `INSERT INTO discovered_pages (test_run_id, url, title, screen_name, page_type, elements_count, screenshot_path, screenshot_data, image_size, image_format, page_source, crawl_depth)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [this.testRunId, url, title, screenName, pageType, elementsCount, screenshotPath, screenshot, imageSize, imageFormat, pageSource, depth]
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

  /**
   * Update test run statistics
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
  async cleanup() {
    try {
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
