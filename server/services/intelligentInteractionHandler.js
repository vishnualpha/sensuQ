const logger = require('../utils/logger');
const SmartFormFiller = require('./smartFormFiller');

class IntelligentInteractionHandler {
  constructor(testGenerator, config) {
    this.testGenerator = testGenerator;
    this.config = config;
    this.formFiller = new SmartFormFiller();
  }

  async handlePageObstacles(page, analysis) {
    // Handle any obstacles identified by AI analysis
    const obstacles = analysis.obstacles || [];
    if (obstacles.length > 0) {
      logger.info(`Handling ${obstacles.length} obstacles from AI analysis`);
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
    } else {
      logger.info('No obstacles identified by AI analysis');
    }
  }

  async dismissAllObstacles(page) {
    try {
      // Wait a moment for any popups to appear
      await page.waitForTimeout(1500);

      // Try dismissing modals first
      try {
        await this.dismissModals(page);
        await page.waitForTimeout(500);
      } catch (e) {
        logger.debug(`Modal dismissal error: ${e.message}`);
      }

      // Then try accepting cookies
      try {
        await this.acceptCookies(page);
        await page.waitForTimeout(500);
      } catch (e) {
        logger.debug(`Cookie acceptance error: ${e.message}`);
      }

      // Then dismiss notifications
      try {
        await this.dismissNotifications(page);
        await page.waitForTimeout(500);
      } catch (e) {
        logger.debug(`Notification dismissal error: ${e.message}`);
      }

      // Finally, try overlay/backdrop clicks
      try {
        await this.dismissOverlays(page);
        await page.waitForTimeout(500);
      } catch (e) {
        logger.debug(`Overlay dismissal error: ${e.message}`);
      }

      // Wait for any animations to complete after dismissal
      await page.waitForTimeout(1000);

      logger.info('Completed proactive obstacle dismissal');
    } catch (error) {
      logger.warn(`Error in dismissAllObstacles: ${error.message}`);
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
      '[aria-label*="dismiss" i]',
      '.modal-close',
      '[data-dismiss="modal"]',
      '[data-dismiss="popup"]',
      'button[class*="modal"] [class*="close"]',
      'button[class*="popup"] [class*="close"]',
      '[role="dialog"] button:has-text("Close")',
      '[role="dialog"] [aria-label*="close" i]'
    ];

    let dismissed = false;

    for (const selector of closeSelectors) {
      try {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const isVisible = await element.isVisible().catch(() => false);
          if (isVisible) {
            await element.click({ timeout: 2000 }).catch(() => {});
            logger.info(`Dismissed modal using: ${selector}`);
            await page.waitForTimeout(1000);
            dismissed = true;
            break;
          }
        }
        if (dismissed) break;
      } catch (error) {
        continue;
      }
    }

    // Always try Escape key as fallback
    try {
      await page.keyboard.press('Escape');
      logger.info('Pressed Escape to dismiss any remaining modals');
      await page.waitForTimeout(500);
    } catch (error) {
      logger.debug('Escape key press failed');
    }
  }

  async acceptCookies(page) {
    const cookieSelectors = [
      'button:has-text("Accept All")',
      'button:has-text("Accept")',
      'button:has-text("I Accept")',
      'button:has-text("Allow All")',
      'button:has-text("Allow")',
      'button:has-text("OK")',
      'button:has-text("Got it")',
      'button:has-text("Agree")',
      '[class*="cookie"] button:has-text("Accept")',
      '[class*="consent"] button:has-text("Accept")',
      '[id*="cookie-accept"]',
      '[id*="accept-cookies"]',
      '[data-testid*="cookie"] button',
      '[data-testid*="consent"] button'
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
      'button:has-text("Maybe Later")',
      'button:has-text("No Thanks")',
      'button:has-text("Skip")',
      'button:has-text("Dismiss")',
      '[class*="notification"] button:has-text("Close")',
      '[class*="banner"] button:has-text("Close")'
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

  async dismissOverlays(page) {
    try {
      // Check for overlay/backdrop elements that might be blocking content
      const overlaySelectors = [
        '[class*="overlay"]',
        '[class*="backdrop"]',
        '[class*="modal-backdrop"]',
        '[class*="popup-overlay"]',
        '[role="presentation"]'
      ];

      for (const selector of overlaySelectors) {
        try {
          const elements = await page.$$(selector);
          for (const element of elements) {
            const isVisible = await element.isVisible().catch(() => false);
            if (isVisible) {
              // Try clicking the overlay (some dismiss on backdrop click)
              await element.click({ timeout: 1000 }).catch(() => {});
              logger.info(`Clicked overlay: ${selector}`);
              await page.waitForTimeout(500);
              break;
            }
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      logger.debug(`Error dismissing overlays: ${error.message}`);
    }
  }

  async performKeyInteractions(page, analysis) {
    const interactions = analysis.keyInteractions || [];

    logger.info(`\n========== KEY INTERACTIONS ANALYSIS ==========`);
    logger.info(`Total interactions suggested by LLM: ${interactions.length}`);
    logger.info(`Full interactions data: ${JSON.stringify(interactions, null, 2)}`);

    const highPriorityInteractions = interactions.filter(i => i.priority === 'high');
    const interactionsToPerform = highPriorityInteractions.length > 0
      ? highPriorityInteractions
      : interactions.slice(0, 3);

    logger.info(`High priority interactions: ${highPriorityInteractions.length}`);
    logger.info(`Will perform ${interactionsToPerform.length} interactions`);

    let successCount = 0;
    let failCount = 0;

    for (const interaction of interactionsToPerform) {
      try {
        logger.info(`\n--- Attempting interaction ${successCount + failCount + 1}/${interactionsToPerform.length} ---`);
        logger.info(`Type: ${interaction.type}, Selector: ${interaction.selector}`);
        logger.info(`Description: ${interaction.description}`);

        const success = await this.executeInteraction(page, interaction);
        if (success) {
          successCount++;
          logger.info(`✅ Interaction succeeded`);
          await page.waitForTimeout(2000);
        } else {
          failCount++;
          logger.warn(`❌ Interaction failed (returned false)`);
        }
      } catch (error) {
        failCount++;
        logger.warn(`❌ Interaction exception: ${interaction.description} - ${error.message}`);
      }
    }

    logger.info(`\n========== INTERACTIONS SUMMARY ==========`);
    logger.info(`Successful: ${successCount}, Failed: ${failCount}, Total: ${interactionsToPerform.length}`);
  }

  async executeInteraction(page, interaction) {
    const { type, selector, value, description } = interaction;
    logger.info(`Executing ${type} interaction: ${description}`);
    logger.info(`Selector: ${selector}`);

    try {
      const elementExists = await page.locator(selector).count();
      logger.info(`Elements matching selector: ${elementExists}`);

      if (elementExists === 0) {
        logger.warn(`No elements found for selector: ${selector}`);
        return false;
      }

      const element = page.locator(selector).first();
      const isVisible = await element.isVisible().catch(() => false);
      logger.info(`Element visible: ${isVisible}`);

      if (!isVisible) {
        logger.warn(`Element exists but not visible: ${selector}`);
        const isHidden = await element.isHidden().catch(() => true);
        if (isHidden) {
          logger.warn(`Element is hidden, attempting to scroll into view`);
          await element.scrollIntoViewIfNeeded().catch(() => {});
        }
      }

      switch (type) {
        case 'click':
          return await this.smartClick(page, element, selector);

        case 'fill':
          return await this.smartFill(page, element, selector, value, interaction);

        case 'select':
          return await this.smartSelect(page, element, selector, value);

        case 'submit':
          await element.click({ timeout: 5000 });
          logger.info(`✅ Successfully submitted form: ${selector}`);
          await page.waitForTimeout(3000);
          return true;

        default:
          logger.warn(`Unknown interaction type: ${type}`);
          return false;
      }
    } catch (error) {
      logger.error(`❌ Failed to execute ${type} on ${selector}`);
      logger.error(`Error: ${error.message}`);
      return false;
    }
  }

  async smartClick(page, element, selector) {
    try {
      // Try standard click first
      await element.click({ timeout: 3000 });
      logger.info(`✅ Successfully clicked: ${selector}`);
      return true;
    } catch (error) {
      logger.warn(`Standard click failed, trying alternatives...`);

      // Try force click (ignoring visibility/actionability checks)
      try {
        await element.click({ force: true, timeout: 3000 });
        logger.info(`✅ Force-clicked: ${selector}`);
        return true;
      } catch (e) {
        logger.debug(`Force click failed: ${e.message}`);
      }

      // Try JavaScript click
      try {
        await element.evaluate(el => el.click());
        logger.info(`✅ JS-clicked: ${selector}`);
        await page.waitForTimeout(500);
        return true;
      } catch (e) {
        logger.debug(`JS click failed: ${e.message}`);
      }

      // Try dispatching click event
      try {
        await element.dispatchEvent('click');
        logger.info(`✅ Dispatched click event: ${selector}`);
        await page.waitForTimeout(500);
        return true;
      } catch (e) {
        logger.debug(`Dispatch click failed: ${e.message}`);
      }

      logger.error(`All click attempts failed for: ${selector}`);
      return false;
    }
  }

  async smartFill(page, element, selector, value, interaction) {
    const initialUrl = page.url();
    const initialModalCount = await page.locator('[role="dialog"], [class*="modal"]').count();

    // Try clicking the field first - some fields open search dialogs/dropdowns
    try {
      await element.click({ timeout: 2000 });
      await page.waitForTimeout(500);
      logger.info(`Clicked field before filling: ${selector}`);

      // Check if a modal/dialog/dropdown appeared
      const newModalCount = await page.locator('[role="dialog"], [class*="modal"], [class*="dropdown"], [class*="autocomplete"]').count();
      if (newModalCount > initialModalCount) {
        logger.info(`Field opened a search dialog/dropdown`);

        // Try to find search input in the dialog
        const dialogInput = page.locator('[role="dialog"] input, [class*="modal"] input, [class*="dropdown"] input, [class*="autocomplete"] input').first();
        const dialogInputExists = await dialogInput.count();

        if (dialogInputExists > 0) {
          const fillValue = value || this.generateContextualValue(interaction, selector);
          await dialogInput.fill(fillValue, { timeout: 3000 });
          logger.info(`✅ Filled search dialog with: ${fillValue}`);
          await page.waitForTimeout(1000);

          // Try to select first option if available
          const firstOption = page.locator('[role="option"], [class*="option"], li[class*="item"]').first();
          const optionExists = await firstOption.count();
          if (optionExists > 0) {
            await firstOption.click({ timeout: 2000 }).catch(() => {});
            logger.info(`✅ Selected first option from dialog`);
          }
          return true;
        }
      }
    } catch (e) {
      logger.debug(`Pre-click failed: ${e.message}`);
    }

    // Try smart form filling
    try {
      const fieldInfo = {
        selector,
        name: await element.getAttribute('name').catch(() => ''),
        label: interaction.description || '',
        placeholder: await element.getAttribute('placeholder').catch(() => '')
      };
      const fillResult = await this.formFiller.analyzeAndFillField(page, selector, fieldInfo);
      if (fillResult.success) {
        logger.info(`✅ Smart-filled ${selector} with: ${fillResult.value}`);
        return true;
      }
    } catch (e) {
      logger.debug(`Smart fill failed: ${e.message}`);
    }

    // Try standard fill
    try {
      const fallbackValue = value || this.generateContextualValue(interaction, selector);
      await element.fill(fallbackValue, { timeout: 3000 });
      logger.info(`✅ Filled ${selector} with: ${fallbackValue}`);
      return true;
    } catch (e) {
      logger.debug(`Standard fill failed: ${e.message}`);
    }

    // Try type (character by character)
    try {
      const fallbackValue = value || this.generateContextualValue(interaction, selector);
      await element.click({ timeout: 2000 });
      await element.type(fallbackValue, { delay: 50 });
      logger.info(`✅ Typed into ${selector}: ${fallbackValue}`);
      return true;
    } catch (e) {
      logger.debug(`Type failed: ${e.message}`);
    }

    logger.error(`All fill attempts failed for: ${selector}`);
    return false;
  }

  async smartSelect(page, element, selector, value) {
    // Try clicking first - might be a custom select that opens a dropdown
    try {
      await element.click({ timeout: 2000 });
      await page.waitForTimeout(500);
      logger.info(`Clicked select element: ${selector}`);

      // Check if dropdown/options appeared
      const dropdownOptions = page.locator('[role="option"], [class*="option"], li[class*="item"]');
      const optionCount = await dropdownOptions.count();

      if (optionCount > 0) {
        logger.info(`Custom select opened with ${optionCount} options`);
        // Try to find and click an option
        if (value) {
          const matchingOption = dropdownOptions.filter({ hasText: value }).first();
          const matchExists = await matchingOption.count();
          if (matchExists > 0) {
            await matchingOption.click({ timeout: 2000 });
            logger.info(`✅ Selected custom option: ${value}`);
            return true;
          }
        }
        // Select first option as fallback
        await dropdownOptions.first().click({ timeout: 2000 });
        logger.info(`✅ Selected first custom option`);
        return true;
      }
    } catch (e) {
      logger.debug(`Custom select handling failed: ${e.message}`);
    }

    // Try standard select
    try {
      const fillResult = await this.formFiller.fillSelectField(page, selector, element);
      logger.info(`✅ Smart-selected option in: ${selector}`);
      return true;
    } catch (e) {
      logger.debug(`Smart select failed: ${e.message}`);
    }

    // Try fallback with provided value
    try {
      if (value) {
        await element.selectOption(value, { timeout: 3000 });
        logger.info(`✅ Selected ${value} in: ${selector}`);
        return true;
      } else {
        // Select first option
        const options = await element.locator('option').all();
        if (options.length > 1) {
          await element.selectOption({ index: 1 });
          logger.info(`✅ Selected first option in: ${selector}`);
          return true;
        }
      }
    } catch (e) {
      logger.debug(`Standard select failed: ${e.message}`);
    }

    logger.error(`All select attempts failed for: ${selector}`);
    return false;
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
