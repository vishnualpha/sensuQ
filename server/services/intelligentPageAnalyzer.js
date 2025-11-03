const logger = require('../utils/logger');
const promptLoader = require('../utils/promptLoader');
const { extractJSON } = require('../utils/jsonExtractor');

class IntelligentPageAnalyzer {
  constructor(testGenerator, config) {
    this.testGenerator = testGenerator;
    this.config = config;
  }

  async analyzePageWithVision(page, url) {
    try {
      // Check if page is still valid
      const pageUrl = await page.url().catch(() => null);
      if (!pageUrl) {
        logger.warn('Page is no longer valid, using fallback analysis');
        return this.getFallbackAnalysis(page, url);
      }

      const screenshot = await page.screenshot({
        fullPage: false,
        type: 'png',
        timeout: 10000
      }).catch(async (error) => {
        logger.warn(`Screenshot failed: ${error.message}, retrying with viewport only`);
        return await page.screenshot({
          fullPage: false,
          type: 'png',
          timeout: 5000
        });
      });

      const screenshotBase64 = screenshot.toString('base64');

      const pageContext = await this.extractPageContext(page);

      if (!pageContext || !pageContext.buttons) {
        logger.warn('Page context extraction returned invalid data, using fallback');
        return this.getFallbackAnalysis(page, url);
      }

      const analysis = await this.getLLMPageAnalysis(screenshotBase64, pageContext, url);

      return analysis;
    } catch (error) {
      logger.error(`Error analyzing page with vision: ${error.message}`);
      return this.getFallbackAnalysis(page, url);
    }
  }

  async extractPageContext(page) {
    try {
      return await page.evaluate(() => {
        try {
        const getElementInfo = (selector) => {
          const elements = Array.from(document.querySelectorAll(selector));
          return elements
            .filter(el => {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return rect.width > 0 && rect.height > 0 &&
                     style.display !== 'none' &&
                     style.visibility !== 'hidden' &&
                     style.opacity !== '0';
            })
            .map(el => ({
              tag: el.tagName.toLowerCase(),
              text: el.textContent?.trim().substring(0, 100),
              attributes: {
                id: el.id,
                class: el.className,
                name: el.name,
                type: el.type,
                href: el.href || el.getAttribute('href'),
                placeholder: el.placeholder,
                'aria-label': el.getAttribute('aria-label'),
                'data-testid': el.getAttribute('data-testid'),
                title: el.getAttribute('title')
              }
            }));
        };

        const getClickableElements = () => {
          const elements = [];
          const selectors = [
            'a',
            'a[href]',
            'button',
            'input[type="submit"]',
            'input[type="button"]',
            'input[type="image"]',
            '[role="button"]',
            '[role="link"]',
            '[onclick]',
            'div[class*="button"]',
            'div[class*="btn"]',
            'div[class*="link"]',
            'span[class*="button"]',
            'span[class*="btn"]',
            'span[class*="link"]',
            '[class*="clickable"]',
            '[class*="interactive"]',
            'div[tabindex]',
            'span[tabindex]',
            'li[class*="menu"] a',
            'nav a',
            '[class*="nav"] a',
            '[class*="menu"] a'
          ];

          const seen = new Set();

          selectors.forEach(selector => {
            try {
              document.querySelectorAll(selector).forEach(el => {
                if (seen.has(el)) return;

                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return;

                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

                const text = el.textContent?.trim().substring(0, 100);
                const hasHref = el.tagName.toLowerCase() === 'a' || el.href;

                // For links and buttons, allow if they have href OR text OR meaningful attributes
                if (!text && !hasHref && !el.getAttribute('aria-label') && !el.getAttribute('title')) return;

                seen.add(el);

                let computedSelector;
                const tag = el.tagName.toLowerCase();

                if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
                  computedSelector = `#${el.id}`;
                } else if (el.getAttribute('name') && /^[a-zA-Z][\w-]*$/.test(el.getAttribute('name'))) {
                  computedSelector = `${tag}[name="${el.getAttribute('name')}"]`;
                } else if (el.getAttribute('data-testid')) {
                  computedSelector = `[data-testid="${el.getAttribute('data-testid')}"]`;
                } else if (el.className && typeof el.className === 'string' && el.className.trim()) {
                  const classes = el.className.trim().split(/\s+/).filter(c => /^[a-zA-Z][\w-]*$/.test(c)).slice(0, 2);
                  if (classes.length > 0) {
                    computedSelector = tag + classes.map(c => `.${c}`).join('');
                  }
                } else if (el.href && tag === 'a') {
                  const href = el.getAttribute('href');
                  if (href && href.length < 100) {
                    computedSelector = `a[href="${href}"]`;
                  }
                }

                // Fallback to nth-of-type path
                if (!computedSelector) {
                  const xpath = [];
                  let current = el;
                  while (current && current !== document.body) {
                    let index = 1;
                    let sibling = current.previousElementSibling;
                    while (sibling) {
                      if (sibling.tagName === current.tagName) index++;
                      sibling = sibling.previousElementSibling;
                    }
                    xpath.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${index})`);
                    current = current.parentElement;
                    if (xpath.length >= 4) break;
                  }
                  computedSelector = xpath.join(' > ');
                }

                elements.push({
                  tag: el.tagName.toLowerCase(),
                  text: text || el.getAttribute('aria-label') || el.getAttribute('title') || '',
                  selector: computedSelector,
                  href: el.href || el.getAttribute('href') || null,
                  hasClickHandler: el.onclick !== null || el.hasAttribute('onclick'),
                  role: el.getAttribute('role'),
                  ariaLabel: el.getAttribute('aria-label'),
                  title: el.getAttribute('title'),
                  name: el.getAttribute('name'),
                  classes: el.className,
                  isNested: el.closest('nav, [role="navigation"], ul, ol, menu') !== null
                });
              });
            } catch (e) {}
          });

          // Sort by priority: navigation elements first, then buttons, then links
          elements.sort((a, b) => {
            const getPriority = (el) => {
              if (el.isNested || el.tag === 'nav') return 0;
              if (el.tag === 'button' || el.tag === 'input') return 1;
              if (el.hasClickHandler) return 2;
              return 3;
            };
            return getPriority(a) - getPriority(b);
          });

          return elements.slice(0, 100);
        };

        const getSimplifiedHTML = () => {
          const clone = document.body.cloneNode(true);

          // Remove script and style tags
          clone.querySelectorAll('script, style, noscript, iframe').forEach(el => el.remove());

          // Remove hidden elements
          Array.from(clone.querySelectorAll('*')).forEach(el => {
            const style = window.getComputedStyle(document.querySelector(el.tagName));
            if (style && (style.display === 'none' || style.visibility === 'hidden')) {
              el.remove();
            }
          });

          // Simplify attributes - keep only useful ones
          Array.from(clone.querySelectorAll('*')).forEach(el => {
            const keepAttrs = ['id', 'class', 'name', 'type', 'href', 'placeholder', 'aria-label', 'role', 'data-testid', 'value'];
            const attrs = Array.from(el.attributes);
            attrs.forEach(attr => {
              if (!keepAttrs.includes(attr.name) && !attr.name.startsWith('data-')) {
                el.removeAttribute(attr.name);
              }
            });

            // Trim text content
            if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
              el.textContent = el.textContent.trim().substring(0, 100);
            }
          });

          return clone.innerHTML.substring(0, 50000); // Limit to 50KB
        };

        return {
          url: window.location.href,
          title: document.title,
          metaDescription: document.querySelector('meta[name="description"]')?.content || '',
          headings: {
            h1: getElementInfo('h1'),
            h2: getElementInfo('h2')
          },
          forms: getElementInfo('form'),
          inputs: getElementInfo('input:not([type="hidden"])'),
          buttons: getElementInfo('button, input[type="submit"], input[type="button"]'),
          links: getElementInfo('a').slice(0, 100),
          clickableElements: getClickableElements(),
          selects: getElementInfo('select'),
          textareas: getElementInfo('textarea'),
          navElements: getElementInfo('nav, [role="navigation"], [class*="nav"], [class*="menu"]'),
          mainContent: document.querySelector('main, [role="main"], article')?.textContent?.trim().substring(0, 500) || '',
          simplifiedHTML: getSimplifiedHTML(),
          hasModals: document.querySelectorAll('[class*="modal"], [class*="dialog"], [class*="popup"]').length > 0,
          hasCookieBanner: document.querySelectorAll('[class*="cookie"], [class*="consent"]').length > 0,
          hasLoginForm: document.querySelectorAll('input[type="password"]').length > 0,
          hasSearchForm: document.querySelectorAll('input[type="search"], input[placeholder*="search" i]').length > 0,
          hasMultiStepForm: document.querySelectorAll('[class*="step"], [class*="wizard"], [data-step]').length > 0
        };
        } catch (evalError) {
          console.error('Error in page.evaluate:', evalError);
          return {
            url: window.location.href,
            title: document.title,
            buttons: [],
            inputs: [],
            links: [],
            clickableElements: [],
            forms: [],
            selects: [],
            textareas: []
          };
        }
      });
    } catch (error) {
      logger.error(`Error extracting page context: ${error.message}`);
      return {
        url: '',
        title: '',
        buttons: [],
        inputs: [],
        links: [],
        clickableElements: [],
        forms: [],
        selects: [],
        textareas: []
      };
    }
  }

  async getLLMPageAnalysis(screenshotBase64, pageContext, url) {
    if (!this.testGenerator || !this.config.api_key) {
      return this.getFallbackAnalysisFromContext(pageContext, url);
    }

    logger.info(`\n========== PAGE CONTEXT EXTRACTION ==========`);
    logger.info(`Clickable elements found: ${pageContext.clickableElements?.length || 0}`);
    logger.info(`Buttons found: ${pageContext.buttons?.length || 0}`);
    logger.info(`Links found: ${pageContext.links?.length || 0}`);
    if (pageContext.clickableElements && pageContext.clickableElements.length > 0) {
      logger.info(`Sample clickable elements: ${JSON.stringify(pageContext.clickableElements.slice(0, 3), null, 2)}`);
    }

    const prompt = promptLoader.renderPrompt('page-analysis.txt', {
      businessContext: this.config.business_context || '',
      url: url,
      title: pageContext.title,
      metaDescription: pageContext.metaDescription,
      headings: JSON.stringify(pageContext.headings.h1),
      formsCount: pageContext.forms.length,
      buttonsCount: pageContext.buttons.length,
      inputsCount: pageContext.inputs.length,
      linksCount: pageContext.links.length,
      clickableElementsCount: pageContext.clickableElements?.length || 0,
      clickableElements: JSON.stringify(pageContext.clickableElements || [], null, 2),
      simplifiedHTML: pageContext.simplifiedHTML || '',
      hasLoginForm: pageContext.hasLoginForm,
      hasSearchForm: pageContext.hasSearchForm,
      hasMultiStepForm: pageContext.hasMultiStepForm,
      hasModals: pageContext.hasModals,
      availableLinks: JSON.stringify(pageContext.links.slice(0, 50), null, 2),
      mainContent: pageContext.mainContent
    });

    try {
      const response = await this.testGenerator.callLLM(prompt);
      const analysis = extractJSON(response);

      logger.info(`\n========== LLM ANALYSIS RESPONSE ==========`);
      logger.info(`Key interactions returned: ${analysis.keyInteractions?.length || 0}`);
      logger.info(`Links to follow: ${analysis.linksToFollow?.length || 0}`);
      if (analysis.keyInteractions && analysis.keyInteractions.length > 0) {
        logger.info(`Sample interactions: ${JSON.stringify(analysis.keyInteractions, null, 2)}`);
      }

      if (analysis.linksToFollow && analysis.linksToFollow.length > 0) {
        analysis.linksToFollow = analysis.linksToFollow.map(link => {
          if (!link.url || link.url === '') {
            const matchingLink = pageContext.links.find(l =>
              l.text && link.text && l.text.toLowerCase().includes(link.text.toLowerCase())
            );
            if (matchingLink) {
              link.url = matchingLink.attributes?.href || '';
            }
          }
          return link;
        }).filter(link => link.url && link.url !== '');
      }

      return analysis;
    } catch (error) {
      logger.warn(`LLM analysis failed: ${error.message}`);
      return this.getFallbackAnalysisFromContext(pageContext, url);
    }
  }

  getFallbackAnalysisFromContext(pageContext, url) {
    const priority = this.calculateFallbackPriority(pageContext);
    const pageType = this.guessPageType(pageContext, url);

    return {
      pageType,
      pageValue: priority > 7 ? 'high' : priority > 4 ? 'medium' : 'low',
      priority,
      businessRelevance: `Page contains ${pageContext.forms.length} forms and ${pageContext.buttons.length} interactive elements`,
      keyInteractions: this.identifyBasicInteractions(pageContext),
      linksToFollow: this.identifyValuableLinks(pageContext),
      testingOpportunities: [
        'Page load and basic functionality',
        'Form validation and submission',
        'Navigation and link functionality'
      ],
      obstacles: this.identifyObstacles(pageContext),
      recommendations: 'Perform basic crawling with form interaction'
    };
  }

  calculateFallbackPriority(pageContext) {
    let priority = 5;

    if (pageContext.hasLoginForm) priority += 2;
    if (pageContext.hasSearchForm) priority += 2;
    if (pageContext.hasMultiStepForm) priority += 1;
    if (pageContext.forms.length > 0) priority += 1;
    if (pageContext.buttons.length > 3) priority += 1;

    return Math.min(priority, 10);
  }

  guessPageType(pageContext, url) {
    const urlLower = url.toLowerCase();

    if (urlLower.includes('login') || pageContext.hasLoginForm) return 'login';
    if (urlLower.includes('search') || pageContext.hasSearchForm) return 'search-results';
    if (urlLower.includes('checkout') || urlLower.includes('cart')) return 'checkout';
    if (urlLower.includes('product') || urlLower.includes('item')) return 'product-detail';
    if (urlLower.includes('dashboard')) return 'dashboard';
    if (urlLower.includes('profile') || urlLower.includes('account')) return 'profile';
    if (pageContext.forms.length > 2) return 'form';
    if (urlLower === '/' || urlLower.endsWith('/')) return 'homepage';

    return 'other';
  }

  identifyBasicInteractions(pageContext) {
    const interactions = [];

    logger.info(`identifyBasicInteractions: clickableElements = ${pageContext.clickableElements?.length || 0}`);

    if (pageContext.clickableElements && pageContext.clickableElements.length > 0) {
      const clickables = pageContext.clickableElements.slice(0, 10);

      clickables.forEach((element, index) => {
        if (element.text && element.text.length > 0) {
          interactions.push({
            description: `Click on "${element.text.substring(0, 50)}" to reveal content`,
            selector: element.selector,
            type: 'click',
            expectedOutcome: `Navigate or reveal new content from ${element.text.substring(0, 30)}`,
            priority: index < 3 ? 'high' : 'medium'
          });
        }
      });
    }

    if (pageContext.buttons && pageContext.buttons.length > 0) {
      pageContext.buttons.slice(0, 5).forEach((button, index) => {
        if (button.text && button.text.length > 0) {
          const selector = button.attributes.id
            ? `#${button.attributes.id}`
            : button.attributes.class
              ? `.${button.attributes.class.split(' ')[0]}`
              : 'button';

          interactions.push({
            description: `Click button: "${button.text.substring(0, 50)}"`,
            selector: selector,
            type: 'click',
            expectedOutcome: `Trigger action from button ${button.text.substring(0, 30)}`,
            priority: index < 2 ? 'high' : 'medium'
          });
        }
      });
    }

    if (pageContext.hasSearchForm && pageContext.inputs.length > 0) {
      const searchInput = pageContext.inputs.find(i =>
        i.attributes.type === 'search' ||
        i.attributes.placeholder?.toLowerCase().includes('search')
      );

      if (searchInput) {
        interactions.push({
          description: 'Perform search to reveal results',
          selector: searchInput.attributes.id ? `#${searchInput.attributes.id}` : 'input[type="search"]',
          type: 'fill',
          value: 'test search',
          expectedOutcome: 'Display search results',
          priority: 'high'
        });
      }
    }

    if (pageContext.hasModals) {
      interactions.push({
        description: 'Close any modals or popups',
        selector: '[class*="close"], [class*="dismiss"]',
        type: 'click',
        expectedOutcome: 'Modal closes',
        priority: 'high'
      });
    }

    logger.info(`identifyBasicInteractions: returning ${interactions.length} interactions`);

    return interactions;
  }

  identifyValuableLinks(pageContext) {
    return pageContext.links.slice(0, 10).map(link => ({
      text: link.text,
      url: link.attributes?.href || '',
      reason: 'Discovered navigation link',
      priority: 'medium',
      estimatedPageType: 'unknown'
    }));
  }

  identifyObstacles(pageContext) {
    const obstacles = [];

    if (pageContext.hasModals) obstacles.push('Modal dialogs present');
    if (pageContext.hasCookieBanner) obstacles.push('Cookie consent banner');
    if (pageContext.hasLoginForm) obstacles.push('Login required');

    return obstacles;
  }

  async getFallbackAnalysis(page, url) {
    const pageContext = await this.extractPageContext(page);
    return this.getFallbackAnalysisFromContext(pageContext, url);
  }
}

module.exports = { IntelligentPageAnalyzer };
