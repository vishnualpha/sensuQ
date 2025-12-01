const logger = require('../utils/logger');
const crypto = require('crypto');

class SPAStateDetector {
  constructor() {
    this.stateSnapshots = new Map();
    this.virtualPageCounter = 0;
  }

  async captureStateSnapshot(page, identifier) {
    try {
      const snapshot = await page.evaluate(() => {
        const mainContent = document.querySelector('main, [role="main"], #main, .main, #content, .content, #app, .app') || document.body;

        // Enhanced modal detection - check for visibility and opacity
        const visibleModals = Array.from(document.querySelectorAll('[role="dialog"], .modal, .popup, [class*="modal"], [class*="dialog"], [class*="overlay"], [aria-modal="true"]'))
          .filter(el => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' &&
                   style.visibility !== 'hidden' &&
                   parseFloat(style.opacity) > 0.1 &&
                   rect.width > 0 &&
                   rect.height > 0;
          });

        // Detect newly visible fields (for multi-step forms)
        const visibleInputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'))
          .filter(el => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' &&
                   style.visibility !== 'hidden' &&
                   rect.width > 0 &&
                   rect.height > 0;
          });

        const getElementSignature = (el) => {
          if (!el) return '';
          const style = window.getComputedStyle(el);
          return {
            tag: el.tagName,
            classes: Array.from(el.classList).slice(0, 5),
            text: el.textContent?.substring(0, 200),
            children: el.children.length,
            visible: style.display !== 'none' && style.visibility !== 'hidden'
          };
        };

        // Get all visible elements, not just their count
        const getVisibleElements = (selector) => {
          return Array.from(document.querySelectorAll(selector))
            .filter(el => {
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return style.display !== 'none' &&
                     style.visibility !== 'hidden' &&
                     rect.width > 0 &&
                     rect.height > 0;
            });
        };

        return {
          url: window.location.href,
          pathname: window.location.pathname,
          hash: window.location.hash,
          title: document.title,
          mainContentSignature: getElementSignature(mainContent),
          hasModal: visibleModals.length > 0,
          modalCount: visibleModals.length,
          modalSignatures: visibleModals.map(getElementSignature),
          interactiveElements: {
            buttons: getVisibleElements('button:not([disabled])').length,
            links: getVisibleElements('a[href]').length,
            inputs: getVisibleElements('input:not([disabled]):not([type="hidden"])').length,
            textareas: getVisibleElements('textarea:not([disabled])').length,
            selects: getVisibleElements('select:not([disabled])').length,
            forms: document.querySelectorAll('form').length,
            // Track specific input types for better detection
            passwordFields: getVisibleElements('input[type="password"]').length,
            emailFields: getVisibleElements('input[type="email"]').length,
            visibleFieldCount: visibleInputs.length
          },
          // Track visible input field signatures for detecting dynamic fields
          visibleFieldSignatures: visibleInputs.slice(0, 20).map(input => ({
            name: input.name,
            type: input.type,
            id: input.id,
            placeholder: input.placeholder
          })),
          bodyClasses: Array.from(document.body.classList),
          timestamp: Date.now()
        };
      });

      const stateHash = this.generateStateHash(snapshot);
      snapshot.stateHash = stateHash;

      this.stateSnapshots.set(identifier, snapshot);

      return snapshot;
    } catch (error) {
      logger.error(`Failed to capture state snapshot: ${error.message}`);
      return null;
    }
  }

  generateStateHash(snapshot) {
    const relevantData = JSON.stringify({
      pathname: snapshot.pathname,
      hash: snapshot.hash,
      title: snapshot.title,
      mainContent: snapshot.mainContentSignature,
      modals: snapshot.modalSignatures,
      interactive: snapshot.interactiveElements
    });

    return crypto.createHash('md5').update(relevantData).digest('hex');
  }

  async detectStateChange(page, beforeIdentifier, afterIdentifier, actionDescription) {
    const beforeState = this.stateSnapshots.get(beforeIdentifier);
    const afterState = await this.captureStateSnapshot(page, afterIdentifier);

    if (!beforeState || !afterState) {
      logger.warn('Cannot compare states - missing snapshot');
      return { changed: false };
    }

    const changes = this.compareStates(beforeState, afterState);

    if (changes.significant) {
      logger.info(`  🔄 Significant state change detected!`);
      logger.info(`     Type: ${changes.changeType}`);
      logger.info(`     Details: ${changes.description}`);

      const virtualPage = {
        type: 'virtual',
        baseUrl: beforeState.url,
        stateIdentifier: `${changes.changeType}_${afterState.stateHash.substring(0, 8)}`,
        changeType: changes.changeType,
        triggeredBy: actionDescription,
        beforeState: beforeState.stateHash,
        afterState: afterState.stateHash,
        changes: changes
      };

      return {
        changed: true,
        significant: true,
        virtualPage,
        changes
      };
    }

    return {
      changed: changes.hasChanges,
      significant: false,
      changes
    };
  }

  compareStates(before, after) {
    const changes = {
      hasChanges: false,
      significant: false,
      changeType: null,
      description: '',
      details: {}
    };

    if (before.stateHash === after.stateHash) {
      return changes;
    }

    changes.hasChanges = true;

    // Priority 1: Modal opened (most important for login flows)
    if (!before.hasModal && after.hasModal) {
      changes.significant = true;
      changes.changeType = 'modal_opened';
      changes.description = `Modal/dialog appeared (${after.modalCount} modal(s))`;
      changes.details.modalCount = after.modalCount;
      changes.details.hasPasswordField = after.interactiveElements.passwordFields > 0;
      return changes;
    }

    // Priority 2: Modal closed
    if (before.hasModal && !after.hasModal) {
      changes.significant = true;
      changes.changeType = 'modal_closed';
      changes.description = 'Modal/dialog closed';
      return changes;
    }

    // Priority 3: Route change (SPA navigation)
    if (after.pathname !== before.pathname) {
      changes.significant = true;
      changes.changeType = 'route_change';
      changes.description = `Route changed: ${before.pathname} → ${after.pathname}`;
      changes.details.fromPath = before.pathname;
      changes.details.toPath = after.pathname;
      return changes;
    }

    // Priority 4: Hash change (anchor navigation)
    if (after.hash !== before.hash && after.hash) {
      changes.significant = true;
      changes.changeType = 'hash_change';
      changes.description = `Hash changed: ${before.hash} → ${after.hash}`;
      changes.details.fromHash = before.hash;
      changes.details.toHash = after.hash;
      return changes;
    }

    // Priority 5: Dynamic form fields appeared/disappeared (multi-step forms)
    const fieldCountDiff = after.interactiveElements.visibleFieldCount - before.interactiveElements.visibleFieldCount;
    if (Math.abs(fieldCountDiff) >= 2) {
      changes.significant = true;
      changes.changeType = 'dynamic_fields';
      changes.description = `Form fields ${fieldCountDiff > 0 ? 'appeared' : 'disappeared'} (${Math.abs(fieldCountDiff)} fields)`;
      changes.details.fieldCountDiff = fieldCountDiff;
      changes.details.newFields = this.findNewFields(before.visibleFieldSignatures, after.visibleFieldSignatures);
      return changes;
    }

    // Priority 6: Password/email field appeared (login form might have appeared)
    if (before.interactiveElements.passwordFields === 0 && after.interactiveElements.passwordFields > 0) {
      changes.significant = true;
      changes.changeType = 'login_form_appeared';
      changes.description = 'Password field appeared - possible login form';
      changes.details.passwordFields = after.interactiveElements.passwordFields;
      return changes;
    }

    // Priority 7: Major content change
    const contentChanged = JSON.stringify(before.mainContentSignature) !== JSON.stringify(after.mainContentSignature);
    if (contentChanged) {
      const childrenDiff = Math.abs(after.mainContentSignature.children - before.mainContentSignature.children);

      // Lowered threshold from 3 to 2 for better sensitivity
      if (childrenDiff >= 2) {
        changes.significant = true;
        changes.changeType = 'content_change';
        changes.description = `Major content change detected (${childrenDiff} element difference)`;
        changes.details.childrenDiff = childrenDiff;
        return changes;
      }
    }

    // Priority 8: Interactive elements changed
    const interactiveDiff = {
      buttons: after.interactiveElements.buttons - before.interactiveElements.buttons,
      inputs: after.interactiveElements.inputs - before.interactiveElements.inputs,
      textareas: after.interactiveElements.textareas - before.interactiveElements.textareas,
      selects: after.interactiveElements.selects - before.interactiveElements.selects,
      forms: after.interactiveElements.forms - before.interactiveElements.forms
    };

    const totalInteractiveDiff = Math.abs(interactiveDiff.buttons) +
                                 Math.abs(interactiveDiff.inputs) +
                                 Math.abs(interactiveDiff.textareas) +
                                 Math.abs(interactiveDiff.selects) +
                                 Math.abs(interactiveDiff.forms);

    // Lowered threshold from 5 to 3 for better sensitivity
    if (totalInteractiveDiff >= 3) {
      changes.significant = true;
      changes.changeType = 'ui_change';
      changes.description = `Significant UI change (${totalInteractiveDiff} interactive elements changed)`;
      changes.details.interactiveDiff = interactiveDiff;
      return changes;
    }

    changes.description = 'Minor state change detected';
    return changes;
  }

  /**
   * Find new fields that appeared in the after state
   */
  findNewFields(beforeFields, afterFields) {
    const beforeIds = new Set(beforeFields.map(f => f.id || f.name).filter(Boolean));
    return afterFields
      .filter(f => {
        const identifier = f.id || f.name;
        return identifier && !beforeIds.has(identifier);
      })
      .map(f => ({ name: f.name, type: f.type, id: f.id }));
  }

  async waitForStateSettlement(page, timeout = 3000) {
    try {
      await Promise.race([
        page.waitForLoadState('networkidle', { timeout }),
        new Promise(resolve => setTimeout(resolve, timeout))
      ]);

      await page.waitForTimeout(500);

      return true;
    } catch (error) {
      logger.debug('State settlement timeout, continuing anyway');
      return false;
    }
  }

  clearSnapshots() {
    this.stateSnapshots.clear();
  }

  getSnapshot(identifier) {
    return this.stateSnapshots.get(identifier);
  }
}

module.exports = SPAStateDetector;
