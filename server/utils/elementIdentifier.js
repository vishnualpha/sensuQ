const logger = require('./logger');

class ElementIdentifier {

  static generateUniqueSelector(element, allElements) {
    const selectors = [];

    if (element.id) {
      return `#${element.id}`;
    }

    if (element.dataTestId) {
      return `[data-testid="${element.dataTestId}"]`;
    }

    if (element.name) {
      const sameNameCount = allElements.filter(el =>
        el.tagName === element.tagName && el.name === element.name
      ).length;
      if (sameNameCount === 1) {
        return `${element.tagName}[name="${element.name}"]`;
      }
    }

    if (element.ariaLabel) {
      const sameAriaCount = allElements.filter(el =>
        el.tagName === element.tagName && el.ariaLabel === element.ariaLabel
      ).length;
      if (sameAriaCount === 1) {
        return `${element.tagName}[aria-label="${element.ariaLabel}"]`;
      }
    }

    let selector = element.tagName.toLowerCase();

    if (element.type) {
      selector += `[type="${element.type}"]`;
    }

    if (element.className && element.className.length > 0) {
      const classes = element.className.split(' ')
        .filter(c => c && !c.match(/^(ng-|mat-|css-|jsx-)/))
        .slice(0, 2);
      if (classes.length > 0) {
        selector += '.' + classes.join('.');
      }
    }

    if (element.role) {
      selector += `[role="${element.role}"]`;
    }

    const sameSelector = allElements.filter(el => {
      let elSelector = el.tagName.toLowerCase();
      if (el.type) elSelector += `[type="${el.type}"]`;
      if (el.className) {
        const classes = el.className.split(' ').filter(c => c && !c.match(/^(ng-|mat-|css-|jsx-)/)).slice(0, 2);
        if (classes.length > 0) elSelector += '.' + classes.join('.');
      }
      if (el.role) elSelector += `[role="${el.role}"]`;
      return elSelector === selector;
    });

    if (sameSelector.length > 1) {
      const index = sameSelector.findIndex(el =>
        el.text === element.text &&
        el.tagName === element.tagName &&
        el.className === element.className
      );
      if (index >= 0) {
        selector += `:nth-of-type(${index + 1})`;
      }
    }

    return selector;
  }

  static buildInteractiveElementsMap(page) {
    return page.evaluate(() => {
      const elements = [];
      const elementMap = new Map();
      let elementId = 1;

      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               style.opacity !== '0' &&
               rect.width > 0 &&
               rect.height > 0;
      };

      const getElementContext = (el) => {
        const context = [];
        const label = el.labels?.[0]?.textContent?.trim();
        if (label) context.push(`label: "${label}"`);

        const placeholder = el.placeholder?.trim();
        if (placeholder) context.push(`placeholder: "${placeholder}"`);

        const parent = el.closest('[role], section, article, nav, aside, form, div[class*="container"]');
        if (parent) {
          const parentRole = parent.getAttribute('role');
          const parentClass = parent.className;
          if (parentRole) context.push(`in [role="${parentRole}"]`);
          else if (parentClass) context.push(`in .${parentClass.split(' ')[0]}`);
        }

        return context.join(', ');
      };

      const addElement = (el, type, priority = 5) => {
        if (!isVisible(el)) return;

        const element = {
          id: `el_${elementId++}`,
          tagName: el.tagName,
          type: el.type || type,
          text: (el.textContent || el.value || '').trim().substring(0, 100),
          className: el.className || '',
          id_attr: el.id || '',
          name: el.name || '',
          dataTestId: el.getAttribute('data-testid') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          role: el.getAttribute('role') || '',
          href: el.href || '',
          placeholder: el.placeholder || '',
          value: el.value || '',
          context: getElementContext(el),
          priority
        };

        elements.push(element);
        elementMap.set(element.id, el);
      };

      document.querySelectorAll('button:not([disabled])').forEach(el => addElement(el, 'button', 8));
      document.querySelectorAll('a[href]:not([href="#"]):not([href=""])').forEach(el => addElement(el, 'link', 7));
      document.querySelectorAll('input:not([type="hidden"]):not([disabled])').forEach(el => addElement(el, 'input', 9));
      document.querySelectorAll('select:not([disabled])').forEach(el => addElement(el, 'select', 9));
      document.querySelectorAll('textarea:not([disabled])').forEach(el => addElement(el, 'textarea', 9));
      document.querySelectorAll('[role="button"]:not([disabled])').forEach(el => addElement(el, 'role-button', 8));
      document.querySelectorAll('[onclick], [ng-click], [@click], [data-action]').forEach(el => {
        if (!el.matches('button, a, input, select, textarea')) {
          addElement(el, 'clickable', 6);
        }
      });

      document.querySelectorAll('[role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"]').forEach(el => {
        if (!elements.find(e => e.id_attr === el.id && e.className === el.className)) {
          addElement(el, el.getAttribute('role'), 7);
        }
      });

      return elements;
    });
  }

  static async buildEnhancedElementsMap(page) {
    const interactiveElements = await this.buildInteractiveElementsMap(page);

    interactiveElements.forEach((element, index) => {
      element.selector = this.generateUniqueSelector(element, interactiveElements);
      element.alternatives = this.generateAlternativeSelectors(element);
    });

    const grouped = {
      inputs: interactiveElements.filter(el => el.type === 'input'),
      buttons: interactiveElements.filter(el => el.type === 'button' || el.type === 'role-button'),
      links: interactiveElements.filter(el => el.type === 'link'),
      selects: interactiveElements.filter(el => el.type === 'select'),
      textareas: interactiveElements.filter(el => el.type === 'textarea'),
      other: interactiveElements.filter(el =>
        !['input', 'button', 'role-button', 'link', 'select', 'textarea'].includes(el.type)
      )
    };

    return {
      all: interactiveElements,
      grouped,
      summary: {
        total: interactiveElements.length,
        byType: {
          inputs: grouped.inputs.length,
          buttons: grouped.buttons.length,
          links: grouped.links.length,
          selects: grouped.selects.length,
          textareas: grouped.textareas.length,
          other: grouped.other.length
        }
      }
    };
  }

  static generateAlternativeSelectors(element) {
    const alternatives = [];

    if (element.text && element.text.length > 0 && element.text.length < 50) {
      if (element.type === 'button' || element.type === 'link') {
        alternatives.push(`text="${element.text}"`);
      }
    }

    if (element.ariaLabel) {
      alternatives.push(`[aria-label="${element.ariaLabel}"]`);
    }

    if (element.placeholder) {
      alternatives.push(`[placeholder="${element.placeholder}"]`);
    }

    if (element.name) {
      alternatives.push(`[name="${element.name}"]`);
    }

    return alternatives;
  }

  static formatForLLM(elementsMap, options = {}) {
    const { maxElements = 100, includeContext = true, groupByType = true } = options;

    if (groupByType) {
      const result = [];

      if (elementsMap.grouped.inputs.length > 0) {
        result.push('=== INPUT FIELDS ===');
        elementsMap.grouped.inputs.slice(0, 20).forEach(el => {
          result.push(`[${el.id}] ${el.selector}`);
          result.push(`  Type: ${el.type}, Name: ${el.name || 'N/A'}`);
          if (el.placeholder) result.push(`  Placeholder: "${el.placeholder}"`);
          if (includeContext && el.context) result.push(`  Context: ${el.context}`);
          result.push('');
        });
      }

      if (elementsMap.grouped.buttons.length > 0) {
        result.push('=== BUTTONS ===');
        elementsMap.grouped.buttons.slice(0, 20).forEach(el => {
          result.push(`[${el.id}] ${el.selector}`);
          if (el.text) result.push(`  Text: "${el.text}"`);
          if (includeContext && el.context) result.push(`  Context: ${el.context}`);
          result.push('');
        });
      }

      if (elementsMap.grouped.links.length > 0) {
        result.push('=== LINKS ===');
        elementsMap.grouped.links.slice(0, 20).forEach(el => {
          result.push(`[${el.id}] ${el.selector}`);
          if (el.text) result.push(`  Text: "${el.text}"`);
          if (el.href) result.push(`  Href: ${el.href}`);
          result.push('');
        });
      }

      if (elementsMap.grouped.selects.length > 0) {
        result.push('=== SELECT DROPDOWNS ===');
        elementsMap.grouped.selects.slice(0, 10).forEach(el => {
          result.push(`[${el.id}] ${el.selector}`);
          if (el.name) result.push(`  Name: ${el.name}`);
          if (includeContext && el.context) result.push(`  Context: ${el.context}`);
          result.push('');
        });
      }

      if (elementsMap.grouped.textareas.length > 0) {
        result.push('=== TEXT AREAS ===');
        elementsMap.grouped.textareas.slice(0, 10).forEach(el => {
          result.push(`[${el.id}] ${el.selector}`);
          if (el.placeholder) result.push(`  Placeholder: "${el.placeholder}"`);
          if (includeContext && el.context) result.push(`  Context: ${el.context}`);
          result.push('');
        });
      }

      if (elementsMap.grouped.other.length > 0) {
        result.push('=== OTHER INTERACTIVE ===');
        elementsMap.grouped.other.slice(0, 10).forEach(el => {
          result.push(`[${el.id}] ${el.selector}`);
          result.push(`  Type: ${el.type}`);
          if (el.text) result.push(`  Text: "${el.text}"`);
          result.push('');
        });
      }

      return result.join('\n');
    } else {
      return elementsMap.all.slice(0, maxElements).map(el => {
        let line = `[${el.id}] ${el.selector} (${el.type})`;
        if (el.text) line += ` - "${el.text}"`;
        if (includeContext && el.context) line += ` | ${el.context}`;
        return line;
      }).join('\n');
    }
  }

  static async extractFromPage(page) {
    try {
      const elementsMap = await this.buildEnhancedElementsMap(page);
      return {
        success: true,
        data: elementsMap,
        formatted: this.formatForLLM(elementsMap)
      };
    } catch (error) {
      logger.error(`Failed to extract elements: ${error.message}`);
      return {
        success: false,
        error: error.message,
        data: null,
        formatted: ''
      };
    }
  }
}

module.exports = { ElementIdentifier };
