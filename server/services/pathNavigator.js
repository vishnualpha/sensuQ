const logger = require('../utils/logger');

class PathNavigator {
  constructor(page, credentials = null) {
    this.page = page;
    this.credentials = credentials; // Store credentials for auth placeholder substitution

    if (credentials) {
      logger.info(`🔑 PathNavigator initialized with credentials: username=${credentials.username || credentials.email || 'NOT SET'}, password=${credentials.password ? '***SET***' : 'NOT SET'}`);
    } else {
      logger.info(`PathNavigator initialized without credentials`);
    }
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
        // Substitute auth placeholders if credentials are available
        let fillValue = step.value || '';
        if (this.credentials) {
          if (fillValue === '{auth_username}') {
            fillValue = this.credentials.username || this.credentials.email;
            logger.info(`  🔑 Substituting {auth_username} with: ${fillValue}`);
          } else if (fillValue === '{auth_password}') {
            fillValue = this.credentials.password;
            logger.info(`  🔑 Substituting {auth_password} with configured password`);
          }
        } else if (fillValue.includes('{auth_')) {
          logger.warn(`  ⚠️ Found placeholder "${fillValue}" but no credentials available for substitution!`);
        }
        await this.page.fill(step.selector, fillValue, { timeout: 10000 });
        await this.page.waitForTimeout(500);
        break;

      case 'type':
        // Substitute auth placeholders if credentials are available
        let typeValue = step.value || '';
        if (this.credentials) {
          if (typeValue === '{auth_username}') {
            typeValue = this.credentials.username || this.credentials.email;
            logger.info(`  🔑 Substituting {auth_username} with: ${typeValue}`);
          } else if (typeValue === '{auth_password}') {
            typeValue = this.credentials.password;
            logger.info(`  🔑 Substituting {auth_password} with configured password`);
          }
        } else if (typeValue.includes('{auth_')) {
          logger.warn(`  ⚠️ Found placeholder "${typeValue}" but no credentials available for substitution!`);
        }
        await this.page.type(step.selector, typeValue, { delay: 50, timeout: 10000 });
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

    try {
      await this.page.evaluate(() => {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch (e) {
          console.log('Could not clear storage:', e.message);
        }
      });
      logger.info('🧹 Cleared browser data (cookies, localStorage, sessionStorage)');
    } catch (error) {
      logger.warn(`Could not clear storage: ${error.message}`);
      logger.info('🧹 Cleared cookies (storage access denied)');
    }
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
