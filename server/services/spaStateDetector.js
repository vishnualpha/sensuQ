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

        const visibleModals = Array.from(document.querySelectorAll('[role="dialog"], .modal, .popup, [class*="modal"], [class*="dialog"]'))
          .filter(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          });

        const getElementSignature = (el) => {
          if (!el) return '';
          return {
            tag: el.tagName,
            classes: Array.from(el.classList).slice(0, 5),
            text: el.textContent?.substring(0, 200),
            children: el.children.length
          };
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
            buttons: document.querySelectorAll('button:not([disabled])').length,
            links: document.querySelectorAll('a[href]').length,
            inputs: document.querySelectorAll('input:not([disabled]):not([type="hidden"])').length,
            forms: document.querySelectorAll('form').length
          },
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

    if (!before.hasModal && after.hasModal) {
      changes.significant = true;
      changes.changeType = 'modal_opened';
      changes.description = `Modal/dialog appeared (${after.modalCount} modal(s))`;
      changes.details.modalCount = after.modalCount;
      return changes;
    }

    if (before.hasModal && !after.hasModal) {
      changes.significant = true;
      changes.changeType = 'modal_closed';
      changes.description = 'Modal/dialog closed';
      return changes;
    }

    if (after.pathname !== before.pathname) {
      changes.significant = true;
      changes.changeType = 'route_change';
      changes.description = `Route changed: ${before.pathname} → ${after.pathname}`;
      changes.details.fromPath = before.pathname;
      changes.details.toPath = after.pathname;
      return changes;
    }

    if (after.hash !== before.hash && after.hash) {
      changes.significant = true;
      changes.changeType = 'hash_change';
      changes.description = `Hash changed: ${before.hash} → ${after.hash}`;
      changes.details.fromHash = before.hash;
      changes.details.toHash = after.hash;
      return changes;
    }

    const contentChanged = JSON.stringify(before.mainContentSignature) !== JSON.stringify(after.mainContentSignature);
    if (contentChanged) {
      const childrenDiff = Math.abs(after.mainContentSignature.children - before.mainContentSignature.children);

      if (childrenDiff >= 3) {
        changes.significant = true;
        changes.changeType = 'content_change';
        changes.description = `Major content change detected (${childrenDiff} element difference)`;
        changes.details.childrenDiff = childrenDiff;
        return changes;
      }
    }

    const interactiveDiff = {
      buttons: after.interactiveElements.buttons - before.interactiveElements.buttons,
      inputs: after.interactiveElements.inputs - before.interactiveElements.inputs,
      forms: after.interactiveElements.forms - before.interactiveElements.forms
    };

    const totalInteractiveDiff = Math.abs(interactiveDiff.buttons) +
                                 Math.abs(interactiveDiff.inputs) +
                                 Math.abs(interactiveDiff.forms);

    if (totalInteractiveDiff >= 5) {
      changes.significant = true;
      changes.changeType = 'ui_change';
      changes.description = `Significant UI change (${totalInteractiveDiff} interactive elements changed)`;
      changes.details.interactiveDiff = interactiveDiff;
      return changes;
    }

    changes.description = 'Minor state change detected';
    return changes;
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
