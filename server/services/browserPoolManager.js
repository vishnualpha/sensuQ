const { chromium } = require('playwright');
const logger = require('../utils/logger');
const crypto = require('crypto');

class BrowserPoolManager {
  constructor(poolSize = 3) {
    this.poolSize = poolSize;
    this.browsers = [];
    this.availableBrowsers = [];
    this.busyBrowsers = new Set();
  }

  async initialize() {
    logger.info(`🚀 Initializing browser pool with ${this.poolSize} browsers...`);

    for (let i = 0; i < this.poolSize; i++) {
      const browser = await this.launchBrowser();
      this.browsers.push(browser);
      this.availableBrowsers.push(browser);
      logger.info(`  ✓ Browser ${i + 1}/${this.poolSize} ready`);
    }

    logger.info(`✅ Browser pool initialized with ${this.poolSize} browsers`);
  }

  async launchBrowser() {
    const browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'SensuQ-Autonomous-Tester/1.0'
    });

    const page = await context.newPage();
    const browserId = crypto.randomUUID();

    return {
      id: browserId,
      browser,
      context,
      page
    };
  }

  async acquireBrowser() {
    while (this.availableBrowsers.length === 0) {
      logger.info('⏳ Waiting for available browser...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const browser = this.availableBrowsers.shift();
    this.busyBrowsers.add(browser.id);
    logger.info(`🔒 Browser ${browser.id} acquired`);
    return browser;
  }

  releaseBrowser(browser) {
    this.busyBrowsers.delete(browser.id);
    this.availableBrowsers.push(browser);
    logger.info(`🔓 Browser ${browser.id} released`);
  }

  async closeAll() {
    logger.info(`🛑 Closing all ${this.browsers.length} browsers...`);

    for (const browser of this.browsers) {
      try {
        await browser.browser.close();
      } catch (error) {
        logger.error(`Error closing browser ${browser.id}: ${error.message}`);
      }
    }

    this.browsers = [];
    this.availableBrowsers = [];
    this.busyBrowsers.clear();

    logger.info('✅ All browsers closed');
  }

  async resetBrowser(browser) {
    try {
      await browser.context.clearCookies();
      await browser.page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      logger.info(`🔄 Browser ${browser.id} reset to clean state`);
    } catch (error) {
      logger.error(`Error resetting browser ${browser.id}: ${error.message}`);
      const newBrowser = await this.launchBrowser();
      await browser.browser.close();

      const index = this.browsers.findIndex(b => b.id === browser.id);
      if (index !== -1) {
        this.browsers[index] = newBrowser;
      }

      return newBrowser;
    }

    return browser;
  }

  getStats() {
    return {
      total: this.browsers.length,
      available: this.availableBrowsers.length,
      busy: this.busyBrowsers.size
    };
  }
}

module.exports = BrowserPoolManager;
