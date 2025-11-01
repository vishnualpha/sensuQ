const logger = require('../utils/logger');

class CrawlTask {
  constructor(url, priority, depth, source, reason) {
    this.url = url;
    this.priority = priority;
    this.depth = depth;
    this.source = source;
    this.reason = reason;
    this.timestamp = Date.now();
  }
}

class SmartCrawlingStrategy {
  constructor(config, startUrl) {
    this.config = config;
    this.startUrl = startUrl;
    this.priorityQueue = [];
    this.visited = new Set();
    this.domainWhitelist = this.extractDomain(startUrl);
    this.maxDepth = config.max_depth || 3;
    this.maxPages = config.max_pages || 50;
    this.crawledCount = 0;
  }

  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      logger.error(`Invalid URL: ${url}`);
      return null;
    }
  }

  isSameDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname === this.domainWhitelist;
    } catch (error) {
      return false;
    }
  }

  shouldCrawlUrl(url, depth) {
    if (!url || url.startsWith('#') || url.startsWith('javascript:') || url.startsWith('mailto:')) {
      return false;
    }

    if (this.visited.has(url)) {
      return false;
    }

    if (!this.isSameDomain(url)) {
      logger.debug(`Skipping external domain: ${url}`);
      return false;
    }

    if (depth > this.maxDepth) {
      logger.debug(`Max depth reached for: ${url}`);
      return false;
    }

    if (this.crawledCount >= this.maxPages) {
      logger.debug(`Max pages reached: ${this.maxPages}`);
      return false;
    }

    const urlLower = url.toLowerCase();
    const excludePatterns = [
      /\.(pdf|jpg|jpeg|png|gif|svg|zip|rar|tar|gz|exe|dmg)$/i,
      /logout/i,
      /signout/i,
      /delete/i,
      /remove/i
    ];

    for (const pattern of excludePatterns) {
      if (pattern.test(urlLower)) {
        logger.debug(`Excluding URL by pattern ${pattern}: ${url}`);
        return false;
      }
    }

    return true;
  }

  addTask(url, priority = 5, depth = 0, source = 'manual', reason = 'Initial crawl') {
    if (!this.shouldCrawlUrl(url, depth)) {
      return false;
    }

    const normalizedUrl = this.normalizeUrl(url);
    if (this.visited.has(normalizedUrl)) {
      return false;
    }

    const task = new CrawlTask(normalizedUrl, priority, depth, source, reason);
    this.priorityQueue.push(task);
    this.sortQueue();

    logger.info(`Added crawl task: ${normalizedUrl} (priority: ${priority}, depth: ${depth}, reason: ${reason})`);
    return true;
  }

  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      urlObj.hash = '';

      const searchParams = new URLSearchParams(urlObj.search);
      const excludeParams = ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid'];
      excludeParams.forEach(param => searchParams.delete(param));

      urlObj.search = searchParams.toString();

      return urlObj.toString().replace(/\/$/, '');
    } catch (error) {
      return url;
    }
  }

  sortQueue() {
    this.priorityQueue.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }

      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }

      return a.timestamp - b.timestamp;
    });
  }

  getNextTask() {
    if (this.priorityQueue.length === 0) {
      return null;
    }

    if (this.crawledCount >= this.maxPages) {
      logger.info(`Max pages reached (${this.maxPages}), stopping crawl`);
      return null;
    }

    const task = this.priorityQueue.shift();
    this.visited.add(task.url);
    this.crawledCount++;

    logger.info(`Next crawl task: ${task.url} (priority: ${task.priority}, depth: ${task.depth}, reason: ${task.reason})`);
    logger.info(`Queue status: ${this.priorityQueue.length} pending, ${this.crawledCount}/${this.maxPages} crawled`);

    return task;
  }

  addLinksFromAnalysis(analysis, currentUrl, currentDepth) {
    if (!analysis.linksToFollow || !Array.isArray(analysis.linksToFollow)) {
      return 0;
    }

    let addedCount = 0;
    const nextDepth = currentDepth + 1;

    for (const link of analysis.linksToFollow) {
      const linkUrl = this.resolveUrl(link.url || link.href, currentUrl);
      if (!linkUrl) continue;

      let priority = 5;
      if (link.priority === 'high') priority = 8;
      else if (link.priority === 'medium') priority = 6;
      else if (link.priority === 'low') priority = 4;

      const reason = link.reason || `Link from ${currentUrl}`;

      if (this.addTask(linkUrl, priority, nextDepth, 'analysis', reason)) {
        addedCount++;
      }
    }

    logger.info(`Added ${addedCount} links from analysis of ${currentUrl}`);
    return addedCount;
  }

  addLinksFromPage(links, currentUrl, currentDepth) {
    if (!links || links.length === 0) {
      return 0;
    }

    let addedCount = 0;
    const nextDepth = currentDepth + 1;

    for (const link of links.slice(0, 20)) {
      const linkUrl = this.resolveUrl(link.url || link.href, currentUrl);
      if (!linkUrl) continue;

      const priority = this.calculateLinkPriority(link);
      const reason = `Link: ${link.text || 'Unknown'}`;

      if (this.addTask(linkUrl, priority, nextDepth, 'page', reason)) {
        addedCount++;
      }
    }

    logger.info(`Added ${addedCount} standard links from ${currentUrl}`);
    return addedCount;
  }

  calculateLinkPriority(link) {
    const text = (link.text || '').toLowerCase();
    const url = (link.url || link.href || '').toLowerCase();

    if (text.includes('login') || url.includes('login')) return 8;
    if (text.includes('sign up') || text.includes('register')) return 8;
    if (text.includes('search') || url.includes('search')) return 7;
    if (text.includes('product') || text.includes('item')) return 7;
    if (text.includes('checkout') || text.includes('cart')) return 7;
    if (text.includes('contact') || url.includes('contact')) return 6;
    if (text.includes('about') || url.includes('about')) return 4;
    if (text.includes('terms') || text.includes('privacy')) return 2;

    return 5;
  }

  resolveUrl(url, baseUrl) {
    try {
      if (!url) return null;

      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }

      const base = new URL(baseUrl);
      const resolved = new URL(url, base);
      return resolved.toString();
    } catch (error) {
      logger.debug(`Failed to resolve URL: ${url} from ${baseUrl}`);
      return null;
    }
  }

  hasMoreWork() {
    return this.priorityQueue.length > 0 && this.crawledCount < this.maxPages;
  }

  getStats() {
    return {
      crawled: this.crawledCount,
      pending: this.priorityQueue.length,
      visited: this.visited.size,
      maxPages: this.maxPages,
      progress: Math.round((this.crawledCount / this.maxPages) * 100)
    };
  }

  clear() {
    this.priorityQueue = [];
    this.visited.clear();
    this.crawledCount = 0;
  }
}

module.exports = { SmartCrawlingStrategy, CrawlTask };
