const logger = require('../utils/logger');
const promptLoader = require('../utils/promptLoader');

class IntelligentPageAnalyzer {
  constructor(testGenerator, config) {
    this.testGenerator = testGenerator;
    this.config = config;
  }

  async analyzePageWithVision(page, url) {
    try {
      const screenshot = await page.screenshot({
        fullPage: false,
        type: 'png'
      });

      const screenshotBase64 = screenshot.toString('base64');

      const pageContext = await this.extractPageContext(page);

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
        const getElementInfo = (selector) => {
          return Array.from(document.querySelectorAll(selector)).map(el => ({
            tag: el.tagName.toLowerCase(),
            text: el.textContent?.trim().substring(0, 100),
            attributes: {
              id: el.id,
              class: el.className,
              name: el.name,
              type: el.type,
              href: el.href,
              placeholder: el.placeholder,
              'aria-label': el.getAttribute('aria-label'),
              'data-testid': el.getAttribute('data-testid')
            }
          }));
        };

        const getClickableElements = () => {
          const elements = [];
          const selectors = [
            'button',
            'a[href]',
            'input[type="submit"]',
            'input[type="button"]',
            '[role="button"]',
            '[onclick]',
            'div[class*="button"]',
            'div[class*="btn"]',
            'span[class*="button"]',
            'span[class*="btn"]',
            '[class*="clickable"]',
            '[class*="interactive"]',
            'div[tabindex]',
            'span[tabindex]'
          ];

          const seen = new Set();

          selectors.forEach(selector => {
            try {
              document.querySelectorAll(selector).forEach(el => {
                if (seen.has(el)) return;

                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return;

                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return;

                const text = el.textContent?.trim().substring(0, 100);
                if (!text && !el.href) return;

                seen.add(el);

                let computedSelector;
                if (el.id) {
                  computedSelector = `#${el.id}`;
                } else if (el.className && typeof el.className === 'string' && el.className.trim()) {
                  const classes = el.className.trim().split(/\s+/).slice(0, 2);
                  computedSelector = classes.map(c => `.${c}`).join('');
                } else if (el.getAttribute('data-testid')) {
                  computedSelector = `[data-testid="${el.getAttribute('data-testid')}"]`;
                } else if (el.href) {
                  computedSelector = `a[href="${el.getAttribute('href')}"]`;
                } else {
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
                    if (xpath.length >= 3) break;
                  }
                  computedSelector = xpath.join(' > ');
                }

                elements.push({
                  tag: el.tagName.toLowerCase(),
                  text: text,
                  selector: computedSelector,
                  href: el.href || null,
                  hasClickHandler: el.onclick !== null || el.hasAttribute('onclick'),
                  role: el.getAttribute('role'),
                  ariaLabel: el.getAttribute('aria-label'),
                  classes: el.className
                });
              });
            } catch (e) {}
          });

          return elements.slice(0, 30);
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
          links: getElementInfo('a[href]').slice(0, 50),
          clickableElements: getClickableElements(),
          selects: getElementInfo('select'),
          textareas: getElementInfo('textarea'),
          navElements: getElementInfo('nav, [role="navigation"]'),
          mainContent: document.querySelector('main, [role="main"], article')?.textContent?.trim().substring(0, 500) || '',
          hasModals: document.querySelectorAll('[class*="modal"], [class*="dialog"], [class*="popup"]').length > 0,
          hasCookieBanner: document.querySelectorAll('[class*="cookie"], [class*="consent"]').length > 0,
          hasLoginForm: document.querySelectorAll('input[type="password"]').length > 0,
          hasSearchForm: document.querySelectorAll('input[type="search"], input[placeholder*="search" i]').length > 0,
          hasMultiStepForm: document.querySelectorAll('[class*="step"], [class*="wizard"], [data-step]').length > 0
        };
      });
    } catch (error) {
      logger.error(`Error extracting page context: ${error.message}`);
      return null;
    }
  }

  async getLLMPageAnalysis(screenshotBase64, pageContext, url) {
    if (!this.testGenerator || !this.config.api_key) {
      return this.getFallbackAnalysisFromContext(pageContext, url);
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
      hasLoginForm: pageContext.hasLoginForm,
      hasSearchForm: pageContext.hasSearchForm,
      hasMultiStepForm: pageContext.hasMultiStepForm,
      hasModals: pageContext.hasModals,
      availableLinks: JSON.stringify(pageContext.links.slice(0, 30), null, 2),
      mainContent: pageContext.mainContent
    });

    try {
      const response = await this.testGenerator.callLLM(prompt);
      const analysis = JSON.parse(response);

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
