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
      '--disable-features=IsolateOrigins,site-per-process,AutomationControlled',
      '--disable-infobars',
      '--window-size=1920,1080',
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-networking',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-ipc-flooding-protection',
      '--disable-hang-monitor',
      '--metrics-recording-only',
      '--mute-audio',
      '--safebrowsing-disable-auto-update',
      '--password-store=basic',
      '--use-mock-keychain',
      '--force-color-profile=srgb',
      '--disable-field-trial-config',
      '--disable-background-mode',
      '--disable-extensions-except=',
      '--disable-extensions',
      '--enable-features=NetworkService,NetworkServiceInProcess',
      '--disable-features=ImprovedCookieControls,LazyFrameLoading,GlobalMediaControls,DestroyProfileOnBrowserClose,MediaRouter,DialMediaRouteProvider,AcceptCHFrame,AutoExpandDetailsElement,CertificateTransparencyComponentUpdater,AvoidUnnecessaryBeforeUnloadCheckSync',
      '--allow-pre-commit-input',
      '--disable-hang-monitor',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--disable-domain-reliability',
      '--disable-component-update'
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
      bypassCSP: true,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
      hasTouch: false,
      isMobile: false,
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
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
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
        // CRITICAL: Remove webdriver from prototype chain
        delete Object.getPrototypeOf(navigator).webdriver;

        // Override the navigator.webdriver property (return false, not undefined)
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false
        });

        // Override chrome detection
        window.chrome = {
          app: {
            isInstalled: false,
            InstallState: {
              DISABLED: 'disabled',
              INSTALLED: 'installed',
              NOT_INSTALLED: 'not_installed'
            },
            RunningState: {
              CANNOT_RUN: 'cannot_run',
              READY_TO_RUN: 'ready_to_run',
              RUNNING: 'running'
            }
          },
          runtime: {
            OnInstalledReason: {
              CHROME_UPDATE: 'chrome_update',
              INSTALL: 'install',
              SHARED_MODULE_UPDATE: 'shared_module_update',
              UPDATE: 'update'
            },
            OnRestartRequiredReason: {
              APP_UPDATE: 'app_update',
              OS_UPDATE: 'os_update',
              PERIODIC: 'periodic'
            },
            PlatformArch: {
              ARM: 'arm',
              ARM64: 'arm64',
              MIPS: 'mips',
              MIPS64: 'mips64',
              X86_32: 'x86-32',
              X86_64: 'x86-64'
            },
            PlatformNaclArch: {
              ARM: 'arm',
              MIPS: 'mips',
              MIPS64: 'mips64',
              X86_32: 'x86-32',
              X86_64: 'x86-64'
            },
            PlatformOs: {
              ANDROID: 'android',
              CROS: 'cros',
              LINUX: 'linux',
              MAC: 'mac',
              OPENBSD: 'openbsd',
              WIN: 'win'
            },
            RequestUpdateCheckStatus: {
              NO_UPDATE: 'no_update',
              THROTTLED: 'throttled',
              UPDATE_AVAILABLE: 'update_available'
            },
            connect: () => {},
            sendMessage: () => {}
          },
          loadTimes: function() {
            return {
              commitLoadTime: Date.now() / 1000 - Math.random() * 10,
              connectionInfo: 'http/1.1',
              finishDocumentLoadTime: Date.now() / 1000 - Math.random() * 5,
              finishLoadTime: Date.now() / 1000 - Math.random() * 3,
              firstPaintAfterLoadTime: Date.now() / 1000 - Math.random() * 2,
              firstPaintTime: Date.now() / 1000 - Math.random() * 4,
              navigationType: 'Other',
              npnNegotiatedProtocol: 'h2',
              requestTime: Date.now() / 1000 - Math.random() * 15,
              startLoadTime: Date.now() / 1000 - Math.random() * 12,
              wasAlternateProtocolAvailable: false,
              wasFetchedViaSpdy: true,
              wasNpnNegotiated: true
            };
          },
          csi: function() {
            return {
              onloadT: Date.now(),
              pageT: Math.random() * 1000,
              startE: Date.now() - Math.random() * 10000,
              tran: 15
            };
          }
        };

        // Mock plugins with realistic data
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

        // Mock hardwareConcurrency
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => 8
        });

        // Mock deviceMemory
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => 8
        });

        // Mock permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters)
        );

        // Mock battery API
        if (!navigator.getBattery) {
          Object.defineProperty(navigator, 'getBattery', {
            value: () => Promise.resolve({
              charging: true,
              chargingTime: 0,
              dischargingTime: Infinity,
              level: 1.0,
              addEventListener: () => {},
              removeEventListener: () => {},
              onchargingchange: null,
              onchargingtimechange: null,
              ondischargingtimechange: null,
              onlevelchange: null
            })
          });
        }

        // Mock connection
        Object.defineProperty(navigator, 'connection', {
          get: () => ({
            effectiveType: '4g',
            rtt: 50,
            downlink: 10,
            saveData: false,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {}
          }),
          configurable: true
        });

        // Mock media devices
        if (!navigator.mediaDevices) {
          Object.defineProperty(navigator, 'mediaDevices', {
            get: () => ({
              enumerateDevices: () => Promise.resolve([
                { deviceId: 'default', kind: 'audioinput', label: '', groupId: '' },
                { deviceId: 'default', kind: 'audiooutput', label: '', groupId: '' },
                { deviceId: 'default', kind: 'videoinput', label: '', groupId: '' }
              ]),
              getUserMedia: () => Promise.reject(new Error('Permission denied')),
              getSupportedConstraints: () => ({
                aspectRatio: true,
                deviceId: true,
                echoCancellation: true,
                facingMode: true,
                frameRate: true,
                groupId: true,
                height: true,
                sampleRate: true,
                sampleSize: true,
                volume: true,
                width: true
              })
            })
          });
        }

        // Override toString methods to avoid detection
        const originalToString = Function.prototype.toString;
        Function.prototype.toString = function() {
          if (this === navigator.permissions.query) {
            return 'function query() { [native code] }';
          }
          if (this === window.chrome.loadTimes) {
            return 'function loadTimes() { [native code] }';
          }
          if (this === window.chrome.csi) {
            return 'function csi() { [native code] }';
          }
          return originalToString.call(this);
        };

        // Remove automation traces
        if (window.document.__proto__) {
          delete window.document.__proto__.documentElement;
        }

        // Spoof notification permission
        const originalNotification = window.Notification;
        Object.defineProperty(window, 'Notification', {
          get: () => {
            const notification = originalNotification;
            notification.permission = 'default';
            return notification;
          }
        });

        // Override iframe contentWindow to hide automation
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          get: function() {
            return window;
          }
        });

        // Fix phantom properties
        Object.defineProperty(navigator, 'maxTouchPoints', {
          get: () => 10
        });

        Object.defineProperty(navigator, 'vendor', {
          get: () => 'Google Inc.'
        });

        Object.defineProperty(navigator, 'platform', {
          get: () => 'Win32'
        });

        // Fix screen properties
        Object.defineProperty(screen, 'availHeight', {
          get: () => 1040
        });

        Object.defineProperty(screen, 'availWidth', {
          get: () => 1920
        });

        Object.defineProperty(screen, 'height', {
          get: () => 1080
        });

        Object.defineProperty(screen, 'width', {
          get: () => 1920
        });

        Object.defineProperty(screen, 'colorDepth', {
          get: () => 24
        });

        Object.defineProperty(screen, 'pixelDepth', {
          get: () => 24
        });

        // Override Intl to match real browser
        if (window.Intl && window.Intl.DateTimeFormat) {
          const originalDateTimeFormat = window.Intl.DateTimeFormat;
          window.Intl.DateTimeFormat = function(...args) {
            const instance = new originalDateTimeFormat(...args);
            instance.resolvedOptions = function() {
              return {
                locale: 'en-US',
                calendar: 'gregory',
                numberingSystem: 'latn',
                timeZone: 'America/New_York',
                hour12: true,
                weekday: undefined,
                era: undefined,
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                second: undefined,
                timeZoneName: undefined
              };
            };
            return instance;
          };
        }
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

  /**
   * Wait for and bypass Cloudflare/bot detection challenges
   */
  static async waitForCloudflareBypass(page, timeout = 30000) {
    try {
      logger.info('🔍 Checking for Cloudflare/bot detection challenge...');

      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const content = await page.content();
        const url = page.url();

        // Check for Cloudflare challenge indicators
        const isCloudflare = content.includes('Checking your browser') ||
                           content.includes('Just a moment') ||
                           content.includes('cloudflare') ||
                           content.includes('cf-browser-verification') ||
                           url.includes('cdn-cgi/challenge-platform');

        // Check for generic error pages
        const isErrorPage = content.includes('GenericError') ||
                          content.includes('"error"') ||
                          content.includes('Access Denied');

        if (!isCloudflare && !isErrorPage) {
          logger.info('✅ No challenge detected or challenge passed');
          return true;
        }

        logger.info('⏳ Challenge detected, waiting...');
        await this.randomDelay(2000, 3000);

        // Try clicking on the challenge if present
        try {
          const challengeButton = await page.$('input[type="checkbox"]');
          if (challengeButton) {
            logger.info('🖱️ Clicking challenge checkbox...');
            await this.humanLikeClick(page, 'input[type="checkbox"]');
            await this.randomDelay(3000, 5000);
          }
        } catch (e) {
          // Challenge button not found or already clicked
        }
      }

      logger.warn('⚠️ Challenge timeout - may still be blocked');
      return false;
    } catch (error) {
      logger.error(`Cloudflare bypass error: ${error.message}`);
      return false;
    }
  }
}

module.exports = StealthConfig;
