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
    const StealthConfig = require('../utils/stealthConfig');

    const browser = await chromium.launch({
      headless: false,
      args: StealthConfig.getBrowserArgs()
    });

    const context = await browser.newContext(StealthConfig.getContextOptions());

    const page = await context.newPage();

    await StealthConfig.applyStealthScripts(page);

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
      const StealthConfig = require('../utils/stealthConfig');

      await browser.context.clearCookies();

      try {
        await browser.page.evaluate(() => {
          try {
            localStorage.clear();
            sessionStorage.clear();
          } catch (e) {
            console.log('Could not clear storage:', e.message);
          }
        });
      } catch (evalError) {
        logger.warn(`Could not clear storage for browser ${browser.id}: ${evalError.message}`);
      }

      // Reapply stealth scripts after reset
      await StealthConfig.applyStealthScripts(browser.page);

      logger.info(`🔄 Browser ${browser.id} reset to clean state with stealth`);
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
