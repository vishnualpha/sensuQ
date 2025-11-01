const { chromium } = require('playwright');
const { pool } = require('../config/database');
const { decrypt } = require('../utils/encryption');
const { AITestGenerator } = require('./aiTestGenerator');
const { IntelligentPageAnalyzer } = require('./intelligentPageAnalyzer');
const { SmartCrawlingStrategy } = require('./smartCrawlingStrategy');
const { IntelligentInteractionHandler } = require('./intelligentInteractionHandler');
const logger = require('../utils/logger');

class PlaywrightCrawler {
  constructor(config, testRunId, io) {
    this.config = config;
    this.testRunId = testRunId;
    this.io = io;
    this.discoveredPages = [];
    this.testGenerator = new AITestGenerator(config);
    this.pageAnalyzer = new IntelligentPageAnalyzer(this.testGenerator, config);
    this.crawlStrategy = new SmartCrawlingStrategy(config, config.target_url);
    this.interactionHandler = new IntelligentInteractionHandler(this.testGenerator, config);
    this.browsers = [];
    this.isRunning = false;
    this.phase = 'idle';
    this.shouldStopCrawling = false;
  }

  async start() {
    try {
      this.isRunning = true;
      this.phase = 'crawling';
      await this.updateRunStatus('running');

      logger.info(`Starting intelligent crawler for test run ${this.testRunId}`);
      this.emitProgress('Starting intelligent crawler with LLM guidance...', 0, 'crawling');

      await this.launchBrowsers();

      if (this.browsers.length === 0) {
        throw new Error('No browsers could be launched');
      }

      this.crawlStrategy.addTask(
        this.config.target_url,
        10,
        0,
        'start',
        'Initial target URL'
      );

      await this.intelligentCrawl();

      if (this.shouldStopCrawling) {
        this.phase = 'generating';
        this.emitProgress('Crawling stopped by user. Starting flow test generation...', 50, 'generating');
      } else {
        this.phase = 'generating';
        this.emitProgress('Crawling completed. Starting flow test generation...', 50, 'generating');
      }

      await this.generateFlowTests();

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
    logger.info(`Stopping crawling for test run ${this.testRunId}`);
    this.shouldStopCrawling = true;

    const stats = this.crawlStrategy.getStats();
    this.emitProgress(
      'Crawling will stop after current page. Finalizing test generation...',
      Math.min(stats.progress * 0.4, 40),
      'crawling'
    );
  }

  async launchBrowsers() {
    const browserConfig = {
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
    };

    try {
      logger.info(`Launching ${browserConfig.name}...`);
      const browser = await browserConfig.type.launch(browserConfig.options);
      this.browsers.push({ type: browserConfig.name, browser });
      logger.info(`Successfully launched ${browserConfig.name}`);
    } catch (error) {
      logger.error(`Failed to launch ${browserConfig.name}: ${error.message}`);
      throw error;
    }
  }

  async intelligentCrawl() {
    const browser = this.browsers[0].browser;
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    if (this.config.credentials) {
      try {
        const credentials = JSON.parse(decrypt(this.config.credentials));
        if (credentials.username && credentials.password) {
          await context.setHTTPCredentials({
            username: credentials.username,
            password: credentials.password
          });
        }
      } catch (error) {
        logger.warn(`Failed to set credentials: ${error.message}`);
      }
    }

    const page = await context.newPage();

    while (this.crawlStrategy.hasMoreWork() && !this.shouldStopCrawling) {
      const task = this.crawlStrategy.getNextTask();

      if (!task) {
        logger.info('No more tasks in queue');
        break;
      }

      try {
        await this.crawlPageIntelligently(page, task);
      } catch (error) {
        logger.error(`Error crawling ${task.url}: ${error.message}`);
      }

      const stats = this.crawlStrategy.getStats();
      const progress = Math.min(stats.progress * 0.4, 40);
      this.emitProgress(
        `Intelligently crawled ${stats.crawled}/${stats.maxPages} pages (${stats.pending} in queue)`,
        progress,
        'crawling'
      );
    }

    await context.close();
    logger.info('Intelligent crawl completed');
  }

  async crawlPageIntelligently(page, task) {
    logger.info(`Crawling page: ${task.url} (depth: ${task.depth}, priority: ${task.priority})`);

    try {
      await page.goto(task.url, {
        waitUntil: 'domcontentloaded',
        timeout: 20000
      });

      await this.interactionHandler.waitForPageStability(page);

      const analysis = await this.pageAnalyzer.analyzePageWithVision(page, task.url);

      logger.info(`Page analysis: type=${analysis.pageType}, value=${analysis.pageValue}, priority=${analysis.priority}`);

      await this.interactionHandler.handlePageObstacles(page, analysis);

      await page.waitForTimeout(1000);

      await this.interactionHandler.performKeyInteractions(page, analysis);

      const title = await page.title();
      const pageElements = await this.pageAnalyzer.extractPageContext(page);
      const elementsCount = pageElements ? pageElements.buttons.length + pageElements.inputs.length + pageElements.links.length : 0;

      let screenshotData = null;
      let imageSize = 0;
      let imageFormat = 'png';

      try {
        logger.info(`Taking screenshot for: ${task.url}`);

        const readiness = await this.interactionHandler.getPageReadiness(page);
        if (!readiness.hasContent) {
          logger.warn('Page has no content, skipping screenshot');
        } else {
          const screenshotBuffer = await page.screenshot({
            fullPage: true,
            type: 'png',
            timeout: 15000,
            animations: 'disabled'
          });

          if (screenshotBuffer && screenshotBuffer.length > 0) {
            screenshotData = screenshotBuffer.toString('base64');
            imageSize = screenshotBuffer.length;
            logger.info(`Screenshot captured: ${imageSize} bytes`);
          }
        }
      } catch (screenshotError) {
        logger.error(`Screenshot failed for ${task.url}: ${screenshotError.message}`);
      }

      const pageResult = await pool.query(`
        INSERT INTO discovered_pages (
          test_run_id, url, title, elements_count,
          screenshot_path, screenshot_data, image_size, image_format, crawl_depth
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [
        this.testRunId,
        task.url,
        title,
        elementsCount,
        null,
        screenshotData,
        imageSize,
        imageFormat,
        task.depth
      ]);

      const pageId = pageResult.rows[0].id;
      logger.info(`Saved page to database: ID=${pageId}`);

      const pageData = {
        id: pageId,
        url: task.url,
        title,
        elementsCount,
        depth: task.depth,
        elements: pageElements,
        analysis
      };

      this.discoveredPages.push(pageData);

      await this.generateTestCasesForPage(pageData);

      const currentCoverage = Math.min((this.discoveredPages.length / this.config.max_pages) * 100, 100);
      await pool.query(`
        UPDATE test_runs
        SET total_pages_discovered = $1, coverage_percentage = $2
        WHERE id = $3
      `, [this.discoveredPages.length, currentCoverage, this.testRunId]);

      this.crawlStrategy.addLinksFromAnalysis(analysis, task.url, task.depth);

      const pageLinks = await this.interactionHandler.extractLinks(page);
      this.crawlStrategy.addLinksFromPage(pageLinks, task.url, task.depth);

    } catch (error) {
      logger.error(`Error in intelligent crawl of ${task.url}: ${error.message}`);
      throw error;
    }
  }

  async generateTestCasesForPage(pageData) {
    try {
      logger.info(`Generating test cases for page: ${pageData.url}`);

      const testCases = await this.testGenerator.generateTestCases({
        url: pageData.url,
        title: pageData.title,
        elementsCount: pageData.elementsCount,
        elements: pageData.elements,
        analysis: pageData.analysis
      });

      let generatedCount = 0;
      for (const testCase of testCases) {
        try {
          await pool.query(`
            INSERT INTO test_cases (
              test_run_id, page_id, test_type, test_name, test_description,
              test_steps, expected_result, status
            )
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

      await pool.query(`
        UPDATE test_runs
        SET total_test_cases = (SELECT COUNT(*) FROM test_cases WHERE test_run_id = $1)
        WHERE id = $1
      `, [this.testRunId]);

      logger.info(`Generated ${generatedCount} test cases for: ${pageData.url}`);

    } catch (error) {
      logger.error(`Error generating test cases: ${error.message}`);
    }
  }

  async generateFlowTests() {
    this.phase = 'generating';
    this.emitProgress('Generating flow-based test cases...', 80, 'generating');

    const pageGroups = this.groupPagesForFlowTesting();
    let totalTestsGenerated = 0;

    for (const group of pageGroups) {
      try {
        const testCases = await this.testGenerator.generateFlowTestCases(group);

        for (const testCase of testCases) {
          await pool.query(`
            INSERT INTO test_cases (
              test_run_id, page_id, test_type, test_name, test_description,
              test_steps, expected_result, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
          `, [
            this.testRunId,
            group[0].id,
            testCase.type,
            testCase.name,
            testCase.description,
            JSON.stringify(testCase.steps || []),
            testCase.expectedResult
          ]);

          totalTestsGenerated++;
        }

        const generationProgress = 80 + ((pageGroups.indexOf(group) + 1) / pageGroups.length) * 15;
        this.emitProgress(`Generated ${totalTestsGenerated} flow test cases...`, generationProgress, 'generating');

      } catch (error) {
        logger.error(`Error generating flow tests: ${error.message}`);
      }
    }

    await pool.query(`
      UPDATE test_runs
      SET total_test_cases = (SELECT COUNT(*) FROM test_cases WHERE test_run_id = $1)
      WHERE id = $1
    `, [this.testRunId]);

    logger.info(`Flow test generation completed: ${totalTestsGenerated} test cases`);
    this.emitProgress(`Flow test generation completed: ${totalTestsGenerated} additional test cases`, 95, 'generating');
  }

  groupPagesForFlowTesting() {
    const groups = [];
    const testGenerationDepth = this.config.test_generation_depth || 3;

    const pagesByDomain = {};

    for (const page of this.discoveredPages) {
      try {
        const url = new URL(page.url);
        const domain = url.hostname;
        const pathParts = url.pathname.split('/').filter(p => p);

        if (!pagesByDomain[domain]) {
          pagesByDomain[domain] = {};
        }

        const groupKey = pathParts.length > 0 ? pathParts[0] : 'root';

        if (!pagesByDomain[domain][groupKey]) {
          pagesByDomain[domain][groupKey] = [];
        }

        pagesByDomain[domain][groupKey].push(page);
      } catch (error) {
        groups.push([page]);
      }
    }

    for (const domain of Object.keys(pagesByDomain)) {
      for (const groupKey of Object.keys(pagesByDomain[domain])) {
        const pages = pagesByDomain[domain][groupKey];
        pages.sort((a, b) => (a.depth || 0) - (b.depth || 0));

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
    const stats = this.crawlStrategy ? this.crawlStrategy.getStats() : { crawled: 0, pending: 0 };

    this.io.emit('crawlerProgress', {
      testRunId: this.testRunId,
      message,
      percentage,
      phase: phase || this.phase,
      canStopCrawling: this.isRunning && this.phase === 'crawling' && !this.shouldStopCrawling,
      discoveredPagesCount: this.discoveredPages.length,
      queueSize: stats.pending,
      timestamp: new Date().toISOString()
    });

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
