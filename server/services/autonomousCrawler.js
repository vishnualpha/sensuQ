const { chromium } = require('playwright');
const logger = require('../utils/logger');
const { VisionElementIdentifier } = require('./visionElementIdentifier');
const { PageLevelTestGenerator } = require('./pageLevelTestGenerator');
const { FlowLevelTestGenerator } = require('./flowLevelTestGenerator');
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

    this.browser = null;
    this.context = null;
    this.page = null;

    this.visitedUrls = new Set();
    this.crawlPaths = [];
    this.currentDepth = 0;
    this.pagesDiscovered = 0;
    this.pathSequence = 0;
  }

  /**
   * Start crawling from base URL
   */
  async start() {
    try {
      logger.info(`Starting autonomous crawl for test run ${this.testRunId}`);
      logger.info(`Target URL: ${this.testConfig.target_url}`);
      logger.info(`Max Depth: ${this.testConfig.max_depth}, Max Pages: ${this.testConfig.max_pages}`);

      await this.initializeBrowser();
      await this.crawlPage(this.testConfig.target_url, null, null, 0);

      logger.info(`Crawl completed. Discovered ${this.pagesDiscovered} pages`);

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

      // Emit completion
      if (this.io) {
        this.io.emit('crawlerProgress', {
          testRunId: this.testRunId,
          phase: 'completed',
          discoveredPagesCount: this.pagesDiscovered,
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

      // Generate page-level tests
      await this.generatePageTests(pageId, url, analysis, analysis.interactiveElements);

      // Try to interact with elements and crawl deeper
      const interactableElements = analysis.interactiveElements.filter(
        el => el.interaction_priority === 'high' || el.interaction_priority === 'medium'
      );

      logger.info(`Found ${interactableElements.length} interactable elements for deeper crawl`);

      for (const element of interactableElements) {
        if (depth >= this.testConfig.max_depth || this.pagesDiscovered >= this.testConfig.max_pages) {
          break;
        }

        const success = await this.interactWithElement(element, pageId, depth);

        if (success) {
          // Element interaction led to navigation or state change
          // The recursive crawl happened inside interactWithElement
        }
      }

      // Check if this is a dead-end page
      const hasNavigableElements = interactableElements.some(
        el => el.element_type === 'link' || el.element_type === 'button'
      );

      if (!hasNavigableElements) {
        logger.info(`Dead-end page detected: ${url}`);
        await this.markPageAsDeadEnd(pageId);

        // Restart browser to crawl from beginning with different path
        if (depth > 0) {
          await this.restartBrowserForNewPath();
        }
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
   * Save discovered page to database
   */
  async saveDiscoveredPage(url, title, screenName, pageType, screenshot, pageSource, elementsCount, depth) {
    const screenshotPath = `screenshots/${this.testRunId}_${Date.now()}.png`;
    // In production, save screenshot to file system or cloud storage
    // For now, we'll store base64 in a separate field

    const result = await pool.query(
      `INSERT INTO discovered_pages (test_run_id, url, title, screen_name, page_type, elements_count, screenshot_path, page_source, crawl_depth)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [this.testRunId, url, title, screenName, pageType, elementsCount, screenshotPath, pageSource, depth]
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
    await pool.query(
      `UPDATE test_runs
       SET total_pages_discovered = $1, status = 'completed', end_time = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [this.pagesDiscovered, this.testRunId]
    );
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
