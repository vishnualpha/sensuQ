const logger = require('../utils/logger');

class IntelligentInteractionHandler {
  constructor(testGenerator, config) {
    this.testGenerator = testGenerator;
    this.config = config;
  }

  async handlePageObstacles(page, analysis) {
    const obstacles = analysis.obstacles || [];
    logger.info(`Handling ${obstacles.length} obstacles on page`);

    for (const obstacle of obstacles) {
      try {
        if (obstacle.toLowerCase().includes('modal') || obstacle.toLowerCase().includes('popup')) {
          await this.dismissModals(page);
        } else if (obstacle.toLowerCase().includes('cookie')) {
          await this.acceptCookies(page);
        } else if (obstacle.toLowerCase().includes('notification')) {
          await this.dismissNotifications(page);
        }
      } catch (error) {
        logger.warn(`Error handling obstacle "${obstacle}": ${error.message}`);
      }
    }
  }

  async dismissModals(page) {
    const closeSelectors = [
      '[class*="close"]',
      '[class*="dismiss"]',
      '[aria-label*="close" i]',
      'button:has-text("Close")',
      'button:has-text("×")',
      '.modal-close',
      '[data-dismiss="modal"]'
    ];

    for (const selector of closeSelectors) {
      try {
        const elements = await page.$$(selector);
        for (const element of elements) {
          if (await element.isVisible()) {
            await element.click({ timeout: 2000 });
            logger.info(`Dismissed modal using: ${selector}`);
            await page.waitForTimeout(1000);
            return;
          }
        }
      } catch (error) {
        continue;
      }
    }

    try {
      await page.keyboard.press('Escape');
      logger.info('Pressed Escape to dismiss modal');
      await page.waitForTimeout(500);
    } catch (error) {
      logger.debug('Escape key did not dismiss modal');
    }
  }

  async acceptCookies(page) {
    const cookieSelectors = [
      'button:has-text("Accept")',
      'button:has-text("Accept All")',
      'button:has-text("I Accept")',
      'button:has-text("OK")',
      'button:has-text("Got it")',
      '[class*="cookie"] button:has-text("Accept")',
      '[id*="cookie-accept"]'
    ];

    for (const selector of cookieSelectors) {
      try {
        const element = await page.$(selector);
        if (element && await element.isVisible()) {
          await element.click({ timeout: 2000 });
          logger.info(`Accepted cookies using: ${selector}`);
          await page.waitForTimeout(1000);
          return;
        }
      } catch (error) {
        continue;
      }
    }
  }

  async dismissNotifications(page) {
    const notificationSelectors = [
      'button:has-text("Not Now")',
      'button:has-text("Maybe Later")',
      'button:has-text("No Thanks")',
      'button:has-text("Skip")',
      '[class*="notification"] button:has-text("Close")'
    ];

    for (const selector of notificationSelectors) {
      try {
        const element = await page.$(selector);
        if (element && await element.isVisible()) {
          await element.click({ timeout: 2000 });
          logger.info(`Dismissed notification using: ${selector}`);
          await page.waitForTimeout(1000);
          return;
        }
      } catch (error) {
        continue;
      }
    }
  }

  async performKeyInteractions(page, analysis) {
    const interactions = analysis.keyInteractions || [];
    const highPriorityInteractions = interactions.filter(i => i.priority === 'high');
    const interactionsToPerform = highPriorityInteractions.length > 0
      ? highPriorityInteractions
      : interactions.slice(0, 3);

    logger.info(`Performing ${interactionsToPerform.length} key interactions`);

    for (const interaction of interactionsToPerform) {
      try {
        const success = await this.executeInteraction(page, interaction);
        if (success) {
          await page.waitForTimeout(2000);
        }
      } catch (error) {
        logger.warn(`Interaction failed: ${interaction.description} - ${error.message}`);
      }
    }
  }

  async executeInteraction(page, interaction) {
    const { type, selector, value, description } = interaction;
    logger.info(`Executing ${type} interaction: ${description}`);

    try {
      await page.waitForSelector(selector, { timeout: 5000, state: 'visible' }).catch(() => null);

      switch (type) {
        case 'click':
          await page.click(selector, { timeout: 5000 });
          logger.info(`Clicked: ${selector}`);
          return true;

        case 'fill':
          const fillValue = value || this.generateContextualValue(interaction, selector);
          await page.fill(selector, fillValue, { timeout: 5000 });
          logger.info(`Filled ${selector} with: ${fillValue}`);
          return true;

        case 'select':
          if (value) {
            await page.selectOption(selector, value, { timeout: 5000 });
            logger.info(`Selected ${value} in: ${selector}`);
            return true;
          }
          break;

        case 'submit':
          await page.click(selector, { timeout: 5000 });
          logger.info(`Submitted form: ${selector}`);
          await page.waitForTimeout(3000);
          return true;

        default:
          logger.warn(`Unknown interaction type: ${type}`);
          return false;
      }
    } catch (error) {
      logger.warn(`Failed to execute ${type} on ${selector}: ${error.message}`);
      return false;
    }
  }

  generateContextualValue(interaction, selector) {
    const businessContext = (this.config.business_context || '').toLowerCase();
    const selectorLower = selector.toLowerCase();

    if (selectorLower.includes('email')) {
      return 'test.user@example.com';
    }

    if (selectorLower.includes('search')) {
      if (businessContext.includes('ecommerce') || businessContext.includes('shop')) {
        return 'laptop';
      } else if (businessContext.includes('travel') || businessContext.includes('flight')) {
        return 'New York';
      } else if (businessContext.includes('real estate')) {
        return 'San Francisco';
      } else {
        return 'test search';
      }
    }

    if (selectorLower.includes('name')) {
      return 'John Doe';
    }

    if (selectorLower.includes('phone')) {
      return '+1-555-123-4567';
    }

    if (selectorLower.includes('city') || selectorLower.includes('location')) {
      return 'New York';
    }

    if (selectorLower.includes('zip') || selectorLower.includes('postal')) {
      return '10001';
    }

    return interaction.value || 'test data';
  }

  async extractLinks(page) {
    try {
      return await page.evaluate(() => {
        const links = [];
        const linkElements = document.querySelectorAll('a[href]');

        linkElements.forEach(link => {
          const href = link.href;
          const text = link.textContent?.trim() || '';
          const isVisible = link.offsetParent !== null;

          if (href && !href.startsWith('javascript:') && !href.startsWith('#') && isVisible) {
            links.push({
              url: href,
              text: text.substring(0, 100),
              href: href
            });
          }
        });

        return links;
      });
    } catch (error) {
      logger.error(`Error extracting links: ${error.message}`);
      return [];
    }
  }

  async waitForPageStability(page) {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});

      await page.waitForTimeout(1500);

      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
        logger.debug('Network not idle, continuing anyway');
      });

      await page.waitForTimeout(1000);
    } catch (error) {
      logger.warn(`Page stability wait interrupted: ${error.message}`);
    }
  }

  async getPageReadiness(page) {
    try {
      return await page.evaluate(() => {
        return {
          readyState: document.readyState,
          hasContent: document.body && document.body.children.length > 0,
          visibleElements: document.querySelectorAll('*:not([hidden])').length,
          isLoading: document.querySelector('[class*="loading"], [class*="spinner"]') !== null
        };
      });
    } catch (error) {
      return {
        readyState: 'unknown',
        hasContent: false,
        visibleElements: 0,
        isLoading: true
      };
    }
  }
}

module.exports = { IntelligentInteractionHandler };
