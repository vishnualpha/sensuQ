const logger = require('./logger');

/**
 * Stealth configuration to bypass bot detection
 * Implements techniques to make Playwright appear as a regular browser
 */
class StealthConfig {
  /**
   * Get browser launch arguments that help avoid detection
   */
  static getBrowserArgs() {
    return [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--allow-running-insecure-content',
      '--disable-infobars',
      '--window-size=1920,1080',
      '--start-maximized',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-networking',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--disable-hang-monitor',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-default-browser-check',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
      '--enable-automation=false',
      '--password-store=basic',
      '--use-mock-keychain',
      '--force-color-profile=srgb'
    ];
  }

  /**
   * Get realistic user agents (rotated)
   */
  static getUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
    ];

    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  /**
   * Get browser context options with stealth settings
   */
  static getContextOptions() {
    return {
      viewport: { width: 1920, height: 1080 },
      userAgent: this.getUserAgent(),
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: ['geolocation', 'notifications'],
      geolocation: { latitude: 40.7128, longitude: -74.0060 },
      colorScheme: 'light',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0'
      }
    };
  }

  /**
   * Apply stealth scripts to page
   * Overrides JavaScript properties that reveal automation
   */
  static async applyStealthScripts(page) {
    try {
      await page.addInitScript(() => {
        // Override the navigator.webdriver property
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
          configurable: true
        });

        // Mock plugins
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            {
              0: { type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: Plugin },
              description: "Portable Document Format",
              filename: "internal-pdf-viewer",
              length: 1,
              name: "Chrome PDF Plugin"
            },
            {
              0: { type: "application/pdf", suffixes: "pdf", description: "", enabledPlugin: Plugin },
              description: "",
              filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
              length: 1,
              name: "Chrome PDF Viewer"
            },
            {
              0: { type: "application/x-nacl", suffixes: "", description: "Native Client Executable", enabledPlugin: Plugin },
              1: { type: "application/x-pnacl", suffixes: "", description: "Portable Native Client Executable", enabledPlugin: Plugin },
              description: "",
              filename: "internal-nacl-plugin",
              length: 2,
              name: "Native Client"
            }
          ]
        });

        // Mock languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en']
        });

        // Mock permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters)
        );

        // Add chrome runtime
        if (!window.chrome) {
          window.chrome = {};
        }

        if (!window.chrome.runtime) {
          window.chrome.runtime = {
            connect: () => {},
            sendMessage: () => {}
          };
        }

        // Override automation-related properties
        delete navigator.__proto__.webdriver;

        // Mock battery API
        Object.defineProperty(navigator, 'getBattery', {
          value: () => Promise.resolve({
            charging: true,
            chargingTime: 0,
            dischargingTime: Infinity,
            level: 1.0
          })
        });

        // Mock connection
        Object.defineProperty(navigator, 'connection', {
          get: () => ({
            effectiveType: '4g',
            rtt: 50,
            downlink: 10,
            saveData: false
          })
        });

        // Override toString methods to avoid detection
        const originalToString = Function.prototype.toString;
        Function.prototype.toString = function() {
          if (this === navigator.permissions.query) {
            return 'function query() { [native code] }';
          }
          return originalToString.call(this);
        };
      });

      logger.info('✅ Stealth scripts applied to page');
    } catch (error) {
      logger.error(`Failed to apply stealth scripts: ${error.message}`);
    }
  }

  /**
   * Add human-like delays
   */
  static async randomDelay(min = 500, max = 2000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Simulate human-like mouse movement before click
   */
  static async humanLikeClick(page, selector) {
    try {
      const element = await page.$(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }

      const box = await element.boundingBox();
      if (box) {
        // Move mouse to element with random offset
        const x = box.x + box.width / 2 + (Math.random() * 10 - 5);
        const y = box.y + box.height / 2 + (Math.random() * 10 - 5);

        await page.mouse.move(x, y, { steps: 10 });
        await this.randomDelay(100, 300);
        await page.mouse.click(x, y);
      } else {
        // Fallback to regular click
        await element.click();
      }
    } catch (error) {
      logger.error(`Human-like click failed: ${error.message}`);
      throw error;
    }
  }
}

module.exports = StealthConfig;
