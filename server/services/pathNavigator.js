const logger = require('../utils/logger');

class PathNavigator {
  constructor(page) {
    this.page = page;
  }

  async executeSteps(steps) {
    logger.info(`📋 Executing ${steps.length} navigation steps`);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      logger.info(`  Step ${i + 1}/${steps.length}: ${step.action} ${step.selector || step.url || ''}`);

      try {
        await this.executeStep(step);
      } catch (error) {
        logger.error(`Failed to execute step ${i + 1}: ${error.message}`);
        throw new Error(`Navigation failed at step ${i + 1}: ${step.action}`);
      }
    }

    logger.info(`✅ Successfully executed all ${steps.length} steps`);
  }

  async executeStep(step) {
    switch (step.action) {
      case 'goto':
        await this.page.goto(step.url, {
          waitUntil: 'domcontentloaded',
          timeout: 45000
        });
        await this.page.waitForTimeout(2000);
        break;

      case 'click':
        await this.page.click(step.selector, { timeout: 10000 });
        await this.page.waitForTimeout(1500);
        break;

      case 'fill':
        await this.page.fill(step.selector, step.value, { timeout: 10000 });
        await this.page.waitForTimeout(500);
        break;

      case 'type':
        await this.page.type(step.selector, step.value, { delay: 50, timeout: 10000 });
        await this.page.waitForTimeout(500);
        break;

      case 'select':
        await this.page.selectOption(step.selector, step.value, { timeout: 10000 });
        await this.page.waitForTimeout(500);
        break;

      case 'check':
        await this.page.check(step.selector, { timeout: 10000 });
        await this.page.waitForTimeout(500);
        break;

      case 'uncheck':
        await this.page.uncheck(step.selector, { timeout: 10000 });
        await this.page.waitForTimeout(500);
        break;

      case 'wait':
        await this.page.waitForTimeout(step.duration || 1000);
        break;

      case 'waitForSelector':
        await this.page.waitForSelector(step.selector, { timeout: step.timeout || 10000 });
        break;

      case 'clearBrowserData':
        await this.clearBrowserData();
        break;

      default:
        logger.warn(`Unknown step action: ${step.action}`);
    }
  }

  async clearBrowserData() {
    const context = this.page.context();
    await context.clearCookies();
    await this.page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    logger.info('🧹 Cleared browser data (cookies, localStorage, sessionStorage)');
  }

  static buildStepSequence(parentSteps, newStep) {
    return [...parentSteps, newStep];
  }

  static createGotoStep(url) {
    return { action: 'goto', url };
  }

  static createClickStep(selector, elementText = '') {
    return { action: 'click', selector, elementText };
  }

  static createFillStep(selector, value) {
    return { action: 'fill', selector, value };
  }

  static createClearBrowserDataStep() {
    return { action: 'clearBrowserData' };
  }
}

module.exports = PathNavigator;
