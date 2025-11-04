const logger = require('../utils/logger');
const promptLoader = require('../utils/promptLoader');
const { extractJSON } = require('../utils/jsonExtractor');
const { ElementIdentifier } = require('../utils/elementIdentifier');

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
        logger.error('Page is no longer valid, cannot analyze');
        throw new Error('Page is no longer valid');
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
        logger.error('Page context extraction returned invalid data');
        throw new Error('Invalid page context');
      }

      const analysis = await this.getLLMPageAnalysis(screenshotBase64, pageContext, url);

      return analysis;
    } catch (error) {
      logger.error(`Error analyzing page with vision: ${error.message}`);
      throw error;
    }
  }

  async extractPageContext(page) {
    try {
      const elementsResult = await ElementIdentifier.extractFromPage(page);

      if (!elementsResult.success) {
        logger.warn('ElementIdentifier failed, falling back to legacy extraction');
        return await this.extractPageContextLegacy(page);
      }

      const pageInfo = await page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title,
          metaDescription: document.querySelector('meta[name="description"]')?.content || '',
          hasModals: document.querySelectorAll('[class*="modal"], [class*="dialog"], [class*="popup"]').length > 0,
          hasCookieBanner: document.querySelectorAll('[class*="cookie"], [class*="consent"]').length > 0,
          hasLoginForm: document.querySelectorAll('input[type="password"]').length > 0,
          hasSearchForm: document.querySelectorAll('input[type="search"], input[placeholder*="search" i]').length > 0,
          hasMultiStepForm: document.querySelectorAll('[class*="step"], [class*="wizard"], [data-step]').length > 0,
          mainContent: document.querySelector('main, [role="main"], article')?.textContent?.trim().substring(0, 500) || ''
        };
      });

      return {
        ...pageInfo,
        elements: elementsResult.data,
        buttons: elementsResult.data.grouped.buttons,
        inputs: elementsResult.data.grouped.inputs,
        links: elementsResult.data.grouped.links,
        selects: elementsResult.data.grouped.selects,
        textareas: elementsResult.data.grouped.textareas,
        forms: [],
        clickableElements: [...elementsResult.data.grouped.buttons, ...elementsResult.data.grouped.other],
        elementsFormatted: elementsResult.formatted
      };
    } catch (error) {
      logger.error(`Error extracting page context: ${error.message}`);
      throw error;
    }
  }

  async extractPageContextLegacy(page) {
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
      logger.error('No LLM configured for page analysis');
      throw new Error('LLM configuration required for page analysis');
    }

    logger.info(`\n========== PAGE CONTEXT EXTRACTION ==========`);
    logger.info(`Clickable elements found: ${pageContext.clickableElements?.length || 0}`);
    logger.info(`Buttons found: ${pageContext.buttons?.length || 0}`);
    logger.info(`Links found: ${pageContext.links?.length || 0}`);
    if (pageContext.clickableElements && pageContext.clickableElements.length > 0) {
      logger.info(`Sample clickable elements: ${JSON.stringify(pageContext.clickableElements.slice(0, 3), null, 2)}`);
    }

    const interactiveElementsSummary = pageContext.elementsFormatted ||
      JSON.stringify(pageContext.clickableElements || [], null, 2);

    const availableLinks = pageContext.links && pageContext.links.length > 0
      ? pageContext.links.map((link, idx) =>
          `[${idx + 1}] "${link.text}" -> ${link.attributes?.href || 'no href'}`
        ).join('\n')
      : 'No links found on this page';

    const prompt = promptLoader.renderPrompt('page-analysis.txt', {
      businessContext: this.config.business_context || '',
      url: url,
      title: pageContext.title,
      metaDescription: pageContext.metaDescription,
      headings: JSON.stringify(pageContext.headings?.h1 || []),
      formsCount: pageContext.forms?.length || 0,
      buttonsCount: pageContext.buttons?.length || 0,
      inputsCount: pageContext.inputs?.length || 0,
      linksCount: pageContext.links?.length || 0,
      clickableElementsCount: pageContext.clickableElements?.length || 0,
      interactiveElements: interactiveElementsSummary,
      availableLinks: availableLinks,
      hasLoginForm: pageContext.hasLoginForm,
      hasSearchForm: pageContext.hasSearchForm,
      hasMultiStepForm: pageContext.hasMultiStepForm,
      hasModals: pageContext.hasModals,
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
      logger.error(`LLM analysis failed: ${error.message}`);
      throw error;
    }
  }

}

module.exports = { IntelligentPageAnalyzer };
