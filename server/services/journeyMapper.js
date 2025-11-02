const logger = require('../utils/logger');

class JourneyMapper {
  constructor() {
    this.journeyGraph = new Map();
    this.entryPoints = new Set();
    this.goalPages = new Set();
  }

  buildJourneyGraph(crawlPaths) {
    this.journeyGraph.clear();
    this.entryPoints.clear();
    this.goalPages.clear();

    logger.info(`Building journey graph from ${crawlPaths.length} crawl paths`);

    for (const path of crawlPaths) {
      this.processPath(path);
    }

    this.identifyEntryAndGoalPages();

    return {
      nodes: this.getGraphNodes(),
      edges: this.getGraphEdges(),
      entryPoints: Array.from(this.entryPoints),
      goalPages: Array.from(this.goalPages),
      statistics: this.calculateGraphStatistics()
    };
  }

  processPath(path) {
    const pages = path.pages || [];

    for (let i = 0; i < pages.length; i++) {
      const currentPage = pages[i];
      const currentUrl = this.normalizeUrl(currentPage.url);

      if (!this.journeyGraph.has(currentUrl)) {
        this.journeyGraph.set(currentUrl, {
          url: currentUrl,
          title: currentPage.title,
          pageType: currentPage.page_type,
          isVirtual: currentPage.is_virtual || false,
          visits: 0,
          outgoingEdges: new Map(),
          incomingEdges: new Map(),
          depth: currentPage.crawl_depth || i
        });
      }

      const node = this.journeyGraph.get(currentUrl);
      node.visits++;

      if (i < pages.length - 1) {
        const nextPage = pages[i + 1];
        const nextUrl = this.normalizeUrl(nextPage.url);

        const interaction = path.interactions?.[i];
        const edgeKey = nextUrl;

        if (!node.outgoingEdges.has(edgeKey)) {
          node.outgoingEdges.set(edgeKey, {
            targetUrl: nextUrl,
            count: 0,
            interactions: []
          });
        }

        const edge = node.outgoingEdges.get(edgeKey);
        edge.count++;
        if (interaction) {
          edge.interactions.push({
            type: interaction.type,
            description: interaction.description
          });
        }

        if (!this.journeyGraph.has(nextUrl)) {
          this.journeyGraph.set(nextUrl, {
            url: nextUrl,
            title: nextPage.title,
            pageType: nextPage.page_type,
            isVirtual: nextPage.is_virtual || false,
            visits: 0,
            outgoingEdges: new Map(),
            incomingEdges: new Map(),
            depth: nextPage.crawl_depth || (i + 1)
          });
        }

        const nextNode = this.journeyGraph.get(nextUrl);
        if (!nextNode.incomingEdges.has(currentUrl)) {
          nextNode.incomingEdges.set(currentUrl, {
            sourceUrl: currentUrl,
            count: 0
          });
        }
        nextNode.incomingEdges.get(currentUrl).count++;
      }
    }
  }

  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      return `${urlObj.origin}${urlObj.pathname}`;
    } catch {
      return url;
    }
  }

  identifyEntryAndGoalPages() {
    for (const [url, node] of this.journeyGraph.entries()) {
      if (node.incomingEdges.size === 0 && node.visits > 0) {
        this.entryPoints.add(url);
      }

      if (node.outgoingEdges.size === 0 && node.visits > 0) {
        this.goalPages.add(url);
      }
    }

    logger.info(`Identified ${this.entryPoints.size} entry points and ${this.goalPages.size} goal pages`);
  }

  getGraphNodes() {
    return Array.from(this.journeyGraph.values()).map(node => ({
      url: node.url,
      title: node.title,
      pageType: node.pageType,
      isVirtual: node.isVirtual,
      visits: node.visits,
      outgoingCount: node.outgoingEdges.size,
      incomingCount: node.incomingEdges.size,
      depth: node.depth,
      importance: this.calculateNodeImportance(node)
    }));
  }

  getGraphEdges() {
    const edges = [];

    for (const [sourceUrl, node] of this.journeyGraph.entries()) {
      for (const [targetUrl, edge] of node.outgoingEdges.entries()) {
        edges.push({
          source: sourceUrl,
          target: targetUrl,
          count: edge.count,
          interactions: edge.interactions.slice(0, 3),
          strength: edge.count / node.visits
        });
      }
    }

    return edges;
  }

  calculateNodeImportance(node) {
    let score = 0;

    score += node.visits * 10;

    score += node.incomingEdges.size * 5;

    score += node.outgoingEdges.size * 3;

    if (this.entryPoints.has(node.url)) {
      score += 20;
    }

    if (this.goalPages.has(node.url)) {
      score += 15;
    }

    const keywords = ['dashboard', 'home', 'login', 'checkout', 'payment', 'profile'];
    const urlLower = node.url.toLowerCase();
    const titleLower = (node.title || '').toLowerCase();

    keywords.forEach(keyword => {
      if (urlLower.includes(keyword) || titleLower.includes(keyword)) {
        score += 10;
      }
    });

    return Math.min(score, 100);
  }

  calculateGraphStatistics() {
    const nodes = Array.from(this.journeyGraph.values());

    return {
      totalPages: nodes.length,
      entryPoints: this.entryPoints.size,
      goalPages: this.goalPages.size,
      averageOutgoingEdges: this.calculateAverage(nodes.map(n => n.outgoingEdges.size)),
      averageIncomingEdges: this.calculateAverage(nodes.map(n => n.incomingEdges.size)),
      maxDepth: Math.max(...nodes.map(n => n.depth), 0),
      mostVisitedPages: this.getMostVisitedPages(nodes, 5),
      orphanPages: nodes.filter(n => n.incomingEdges.size === 0 && n.outgoingEdges.size === 0).length
    };
  }

  calculateAverage(numbers) {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  }

  getMostVisitedPages(nodes, limit) {
    return nodes
      .sort((a, b) => b.visits - a.visits)
      .slice(0, limit)
      .map(n => ({
        url: n.url,
        title: n.title,
        visits: n.visits
      }));
  }

  findCriticalPaths(fromUrl, toUrl, maxDepth = 10) {
    const paths = [];
    const visited = new Set();

    const dfs = (currentUrl, targetUrl, path, depth) => {
      if (depth > maxDepth) return;
      if (visited.has(currentUrl)) return;
      if (currentUrl === targetUrl) {
        paths.push([...path]);
        return;
      }

      visited.add(currentUrl);
      const node = this.journeyGraph.get(currentUrl);

      if (node) {
        for (const [nextUrl, edge] of node.outgoingEdges.entries()) {
          path.push({
            from: currentUrl,
            to: nextUrl,
            count: edge.count,
            interactions: edge.interactions
          });
          dfs(nextUrl, targetUrl, path, depth + 1);
          path.pop();
        }
      }

      visited.delete(currentUrl);
    };

    dfs(fromUrl, toUrl, [], 0);

    return paths.sort((a, b) => b.length - a.length);
  }

  identifyCommonJourneys(minSupport = 2) {
    const journeyPatterns = new Map();

    for (const [url, node] of this.journeyGraph.entries()) {
      if (this.entryPoints.has(url)) {
        const journeys = this.traceJourneysFromEntry(url, 5);
        journeys.forEach(journey => {
          const key = journey.map(j => j.url).join(' -> ');
          if (!journeyPatterns.has(key)) {
            journeyPatterns.set(key, { journey, count: 0 });
          }
          journeyPatterns.get(key).count++;
        });
      }
    }

    const commonJourneys = Array.from(journeyPatterns.values())
      .filter(j => j.count >= minSupport)
      .sort((a, b) => b.count - a.count)
      .map(j => ({
        pages: j.journey,
        frequency: j.count,
        length: j.journey.length
      }));

    logger.info(`Found ${commonJourneys.length} common journeys with min support ${minSupport}`);

    return commonJourneys;
  }

  traceJourneysFromEntry(entryUrl, maxLength) {
    const journeys = [];
    const visited = new Set();

    const dfs = (currentUrl, path) => {
      if (path.length >= maxLength) {
        if (path.length > 1) {
          journeys.push([...path]);
        }
        return;
      }

      if (visited.has(currentUrl)) return;

      visited.add(currentUrl);
      const node = this.journeyGraph.get(currentUrl);

      if (!node || node.outgoingEdges.size === 0) {
        if (path.length > 1) {
          journeys.push([...path]);
        }
      } else {
        for (const [nextUrl] of node.outgoingEdges.entries()) {
          path.push({ url: nextUrl, title: this.journeyGraph.get(nextUrl)?.title });
          dfs(nextUrl, path);
          path.pop();
        }
      }

      visited.delete(currentUrl);
    };

    dfs(entryUrl, [{ url: entryUrl, title: this.journeyGraph.get(entryUrl)?.title }]);

    return journeys;
  }

  detectCircularDependencies() {
    const circular = [];

    for (const [url, node] of this.journeyGraph.entries()) {
      const cycles = this.findCyclesFromNode(url);
      cycles.forEach(cycle => {
        circular.push({
          cycle,
          length: cycle.length
        });
      });
    }

    return circular;
  }

  findCyclesFromNode(startUrl, maxDepth = 10) {
    const cycles = [];
    const visited = new Set();
    const recursionStack = new Set();

    const dfs = (currentUrl, path, depth) => {
      if (depth > maxDepth) return;

      if (recursionStack.has(currentUrl)) {
        const cycleStart = path.indexOf(currentUrl);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
        return;
      }

      if (visited.has(currentUrl)) return;

      visited.add(currentUrl);
      recursionStack.add(currentUrl);

      const node = this.journeyGraph.get(currentUrl);
      if (node) {
        for (const [nextUrl] of node.outgoingEdges.entries()) {
          path.push(nextUrl);
          dfs(nextUrl, path, depth + 1);
          path.pop();
        }
      }

      recursionStack.delete(currentUrl);
    };

    dfs(startUrl, [startUrl], 0);

    return cycles;
  }
}

module.exports = JourneyMapper;
