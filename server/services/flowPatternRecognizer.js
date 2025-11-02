const logger = require('../utils/logger');

class FlowPatternRecognizer {
  constructor() {
    this.patterns = {
      authentication: {
        name: 'Authentication Flow',
        keywords: ['login', 'signin', 'sign-in', 'auth', 'authenticate'],
        successIndicators: ['dashboard', 'home', 'profile', 'welcome', 'logout'],
        errorIndicators: ['error', 'invalid', 'incorrect', 'failed'],
        priority: 'critical',
        weight: 100
      },
      registration: {
        name: 'Registration Flow',
        keywords: ['register', 'signup', 'sign-up', 'create account', 'join'],
        successIndicators: ['welcome', 'verify', 'confirmation', 'dashboard', 'success'],
        errorIndicators: ['exists', 'taken', 'invalid', 'error'],
        priority: 'critical',
        weight: 95
      },
      checkout: {
        name: 'Checkout Flow',
        keywords: ['cart', 'checkout', 'payment', 'order', 'purchase', 'buy'],
        successIndicators: ['confirmation', 'success', 'thank you', 'order complete', 'receipt'],
        errorIndicators: ['declined', 'failed', 'error', 'invalid card'],
        priority: 'critical',
        weight: 100
      },
      search: {
        name: 'Search Flow',
        keywords: ['search', 'find', 'query', 'results'],
        successIndicators: ['results', 'found', 'matches', 'detail', 'view'],
        errorIndicators: ['no results', 'not found', 'empty'],
        priority: 'high',
        weight: 70
      },
      crud_create: {
        name: 'Create/Add Flow',
        keywords: ['create', 'add', 'new', 'compose', 'post'],
        successIndicators: ['created', 'added', 'success', 'saved', 'published'],
        errorIndicators: ['failed', 'error', 'invalid'],
        priority: 'high',
        weight: 75
      },
      crud_edit: {
        name: 'Edit/Update Flow',
        keywords: ['edit', 'update', 'modify', 'change', 'settings'],
        successIndicators: ['updated', 'saved', 'success', 'changes saved'],
        errorIndicators: ['failed', 'error', 'invalid'],
        priority: 'high',
        weight: 70
      },
      crud_delete: {
        name: 'Delete Flow',
        keywords: ['delete', 'remove', 'trash', 'archive'],
        successIndicators: ['deleted', 'removed', 'success'],
        errorIndicators: ['failed', 'error', 'cannot delete'],
        priority: 'high',
        weight: 65
      },
      multi_step_form: {
        name: 'Multi-Step Form',
        keywords: ['step', 'next', 'continue', 'wizard', 'progress'],
        successIndicators: ['complete', 'finish', 'submit', 'done', 'success'],
        errorIndicators: ['invalid', 'required', 'error'],
        priority: 'medium',
        weight: 60
      },
      profile_management: {
        name: 'Profile Management',
        keywords: ['profile', 'account', 'settings', 'preferences'],
        successIndicators: ['saved', 'updated', 'success'],
        errorIndicators: ['error', 'invalid', 'failed'],
        priority: 'medium',
        weight: 50
      },
      navigation: {
        name: 'Navigation Flow',
        keywords: ['menu', 'nav', 'browse', 'explore'],
        successIndicators: [],
        errorIndicators: [],
        priority: 'low',
        weight: 30
      }
    };
  }

  analyzeFlow(crawlPath) {
    const pages = crawlPath.pages || [];
    const interactions = crawlPath.interactions || [];

    if (pages.length === 0) {
      return {
        patternType: 'unknown',
        confidence: 0,
        priority: 'low',
        qualityScore: 0
      };
    }

    const detectedPatterns = [];

    for (const [patternKey, pattern] of Object.entries(this.patterns)) {
      const confidence = this.calculatePatternConfidence(pages, interactions, pattern);
      if (confidence > 0.3) {
        detectedPatterns.push({
          type: patternKey,
          name: pattern.name,
          confidence,
          priority: pattern.priority,
          weight: pattern.weight
        });
      }
    }

    detectedPatterns.sort((a, b) => b.confidence - a.confidence);

    if (detectedPatterns.length > 0) {
      const bestPattern = detectedPatterns[0];
      const qualityScore = this.calculateQualityScore(pages, interactions, bestPattern);

      return {
        patternType: bestPattern.type,
        patternName: bestPattern.name,
        confidence: bestPattern.confidence,
        priority: bestPattern.priority,
        qualityScore,
        alternativePatterns: detectedPatterns.slice(1, 3)
      };
    }

    const qualityScore = this.calculateQualityScore(pages, interactions, null);
    return {
      patternType: 'unknown',
      patternName: 'Generic Flow',
      confidence: 0,
      priority: 'low',
      qualityScore
    };
  }

  calculatePatternConfidence(pages, interactions, pattern) {
    let score = 0;
    let maxScore = 0;

    const allText = pages.map(p => {
      const url = (p.url || '').toLowerCase();
      const title = (p.title || '').toLowerCase();
      const screenName = (p.screen_name || '').toLowerCase();
      return `${url} ${title} ${screenName}`;
    }).join(' ');

    maxScore += pattern.keywords.length * 2;
    pattern.keywords.forEach(keyword => {
      if (allText.includes(keyword)) {
        score += 2;
      }
    });

    maxScore += pattern.successIndicators.length;
    pattern.successIndicators.forEach(indicator => {
      if (allText.includes(indicator)) {
        score += 1;
      }
    });

    maxScore += pattern.errorIndicators.length * 0.5;
    pattern.errorIndicators.forEach(indicator => {
      if (allText.includes(indicator)) {
        score += 0.5;
      }
    });

    const interactionText = interactions.map(i => (i.description || '')).join(' ').toLowerCase();
    maxScore += pattern.keywords.length;
    pattern.keywords.forEach(keyword => {
      if (interactionText.includes(keyword)) {
        score += 1;
      }
    });

    if (maxScore === 0) return 0;
    return Math.min(score / maxScore, 1);
  }

  calculateQualityScore(pages, interactions, pattern) {
    let score = 0;

    score += Math.min(pages.length * 10, 30);

    score += Math.min(interactions.length * 5, 25);

    const uniquePageTypes = new Set(pages.map(p => p.page_type));
    score += Math.min(uniquePageTypes.size * 3, 15);

    if (pattern) {
      score += pattern.weight * 0.3;
    }

    const hasFormInteractions = interactions.some(i =>
      i.type === 'fill' || i.type === 'select' || i.type === 'submit'
    );
    if (hasFormInteractions) {
      score += 10;
    }

    const depth = pages.length;
    if (depth >= 3 && depth <= 6) {
      score += 10;
    } else if (depth > 6) {
      score -= 5;
    }

    return Math.max(0, Math.min(score, 100));
  }

  identifyJourneyType(pages) {
    if (pages.length === 0) return 'empty';
    if (pages.length === 1) return 'single-page';

    const firstPage = pages[0];
    const lastPage = pages[pages.length - 1];

    if (firstPage.url === lastPage.url) {
      return 'circular';
    }

    const pageUrls = pages.map(p => p.url);
    const uniqueUrls = new Set(pageUrls);
    if (uniqueUrls.size < pages.length * 0.7) {
      return 'repetitive';
    }

    return 'linear';
  }

  extractFlowMetadata(crawlPath, patternAnalysis) {
    const pages = crawlPath.pages || [];
    const interactions = crawlPath.interactions || [];

    return {
      patternType: patternAnalysis.patternType,
      patternName: patternAnalysis.patternName,
      confidence: patternAnalysis.confidence,
      priority: patternAnalysis.priority,
      qualityScore: patternAnalysis.qualityScore,
      journeyType: this.identifyJourneyType(pages),
      pageCount: pages.length,
      interactionCount: interactions.length,
      startPage: pages[0]?.url || null,
      endPage: pages[pages.length - 1]?.url || null,
      pagesInFlow: pages.map(p => ({
        url: p.url,
        title: p.title,
        pageType: p.page_type,
        isVirtual: p.is_virtual || false
      })),
      successCriteria: this.generateSuccessCriteria(patternAnalysis.patternType),
      estimatedDuration: this.estimateDuration(pages, interactions)
    };
  }

  generateSuccessCriteria(patternType) {
    const criteria = {
      authentication: [
        'User successfully logs in',
        'Dashboard or home page is displayed',
        'User session is created'
      ],
      registration: [
        'User account is created',
        'Confirmation email is sent or displayed',
        'User is redirected to welcome or dashboard page'
      ],
      checkout: [
        'Order is created',
        'Payment is processed',
        'Confirmation page is displayed',
        'Order number is generated'
      ],
      search: [
        'Search query is submitted',
        'Results are displayed',
        'Results are relevant to query'
      ],
      crud_create: [
        'New item is created',
        'Success message is displayed',
        'User is redirected to item detail or list'
      ],
      crud_edit: [
        'Item is updated',
        'Changes are saved',
        'Success message is displayed'
      ],
      crud_delete: [
        'Item is removed',
        'Success message is displayed',
        'Item no longer appears in list'
      ],
      multi_step_form: [
        'User completes all steps',
        'Form data is submitted',
        'Confirmation is displayed'
      ],
      profile_management: [
        'Profile changes are saved',
        'Success message is displayed',
        'Updated information is reflected'
      ]
    };

    return criteria[patternType] || ['Flow completes without errors'];
  }

  estimateDuration(pages, interactions) {
    const pageLoadTime = pages.length * 2;
    const interactionTime = interactions.length * 1;
    return Math.ceil(pageLoadTime + interactionTime);
  }

  sortFlowsByPriority(flows) {
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };

    return flows.sort((a, b) => {
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;

      return b.qualityScore - a.qualityScore;
    });
  }
}

module.exports = FlowPatternRecognizer;
