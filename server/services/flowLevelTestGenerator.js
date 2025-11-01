const logger = require('../utils/logger');
const { AITestGenerator } = require('./aiTestGenerator');
const db = require('../config/database');

/**
 * Generate flow-level tests by analyzing crawl paths and user journeys
 */
class FlowLevelTestGenerator {
  constructor(llmConfig) {
    this.config = llmConfig;
    this.testGenerator = null;

    if (llmConfig && llmConfig.api_key) {
      this.testGenerator = new AITestGenerator(llmConfig);
    }
  }

  /**
   * Generate flow-level tests for a test run
   */
  async generateFlows(testRunId) {
    try {
      logger.info(`Generating flow-level tests for test run ${testRunId}`);

      // Get all crawl paths for this test run
      const crawlPaths = await this.getCrawlPaths(testRunId);

      if (crawlPaths.length === 0) {
        logger.warn('No crawl paths found, skipping flow generation');
        return [];
      }

      // Get all pages and their elements
      const pages = await this.getDiscoveredPages(testRunId);

      // Build flow sequences from paths
      const flowSequences = this.buildFlowSequences(crawlPaths, pages);

      logger.info(`Built ${flowSequences.length} potential flow sequences`);

      // Use LLM to identify meaningful flows
      const meaningfulFlows = await this.identifyMeaningfulFlows(flowSequences, pages);

      // Save flows to database
      const savedFlows = [];
      for (const flow of meaningfulFlows) {
        const flowId = await this.saveUserFlow(testRunId, flow);
        savedFlows.push({ ...flow, id: flowId });

        // Generate test case for this flow
        await this.generateFlowTestCase(testRunId, flowId, flow);
      }

      logger.info(`Generated ${savedFlows.length} meaningful user flows`);

      return savedFlows;

    } catch (error) {
      logger.error(`Failed to generate flow-level tests: ${error.message}`);
      return [];
    }
  }

  /**
   * Get crawl paths from database
   */
  async getCrawlPaths(testRunId) {
    const result = await db.query(
      `SELECT cp.*,
              from_page.url as from_url, from_page.screen_name as from_screen_name,
              to_page.url as to_url, to_page.screen_name as to_screen_name,
              elem.element_type, elem.text_content, elem.selector
       FROM crawl_paths cp
       LEFT JOIN discovered_pages from_page ON from_page.id = cp.from_page_id
       LEFT JOIN discovered_pages to_page ON to_page.id = cp.to_page_id
       LEFT JOIN page_interactive_elements elem ON elem.id = cp.interaction_element_id
       WHERE cp.test_run_id = $1
       ORDER BY cp.path_sequence`,
      [testRunId]
    );

    return result.rows;
  }

  /**
   * Get discovered pages from database
   */
  async getDiscoveredPages(testRunId) {
    const result = await db.query(
      `SELECT dp.*,
              (SELECT json_agg(pie.*)
               FROM page_interactive_elements pie
               WHERE pie.page_id = dp.id) as interactive_elements
       FROM discovered_pages dp
       WHERE dp.test_run_id = $1`,
      [testRunId]
    );

    return result.rows;
  }

  /**
   * Build flow sequences from crawl paths
   */
  buildFlowSequences(crawlPaths, pages) {
    const sequences = [];
    const visited = new Set();

    // Find all starting points (pages with no incoming paths or from base URL)
    const startingPaths = crawlPaths.filter(path => !path.from_page_id);

    // Build sequences using DFS
    for (const startPath of startingPaths) {
      const sequence = this.buildSequenceFromPath(startPath, crawlPaths, [], visited);
      if (sequence.length > 1) {
        sequences.push(sequence);
      }
    }

    // Also find sequences that start from any page (for different entry points)
    const allStartPages = new Set(crawlPaths.map(p => p.from_page_id).filter(Boolean));
    for (const startPageId of allStartPages) {
      const pathsFromPage = crawlPaths.filter(p => p.from_page_id === startPageId);
      for (const path of pathsFromPage) {
        const sequence = this.buildSequenceFromPath(path, crawlPaths, [], new Set());
        if (sequence.length > 1) {
          sequences.push(sequence);
        }
      }
    }

    return sequences;
  }

  /**
   * Build a sequence from a starting path using DFS
   */
  buildSequenceFromPath(currentPath, allPaths, currentSequence, visited) {
    if (visited.has(currentPath.id)) {
      return currentSequence;
    }

    visited.add(currentPath.id);
    currentSequence.push(currentPath);

    // Find next paths
    const nextPaths = allPaths.filter(p => p.from_page_id === currentPath.to_page_id);

    if (nextPaths.length === 0) {
      return currentSequence;
    }

    // Continue with first next path (can be enhanced for multiple branches)
    const nextPath = nextPaths[0];
    return this.buildSequenceFromPath(nextPath, allPaths, currentSequence, visited);
  }

  /**
   * Use LLM to identify meaningful flows
   */
  async identifyMeaningfulFlows(flowSequences, pages) {
    if (!this.testGenerator || flowSequences.length === 0) {
      logger.warn('No LLM configured or no sequences to analyze');
      return this.generateBasicFlows(flowSequences);
    }

    const prompt = `You are an expert test automation engineer analyzing user flows through a web application.

I have discovered the following navigation sequences during crawling:

${flowSequences.slice(0, 10).map((seq, idx) => {
      return `\nFlow ${idx + 1}:
${seq.map((path, stepIdx) => `  ${stepIdx + 1}. ${path.from_screen_name || path.from_url} → [${path.element_type}: "${path.text_content}"] → ${path.to_screen_name || path.to_url}`).join('\n')}`;
    }).join('\n')}

Your task:
1. Identify meaningful user flows that represent real user journeys
2. Name each flow descriptively (e.g., "User Registration Flow", "Product Search and Purchase")
3. Explain the business value of testing this flow
4. Classify the flow type (authentication, shopping, search, navigation, form-submission, etc.)
5. Estimate the coverage impact (how critical is this flow?)

RESPOND ONLY WITH VALID JSON:
{
  "flows": [
    {
      "flowName": "Descriptive flow name",
      "flowDescription": "What user journey this represents",
      "flowType": "flow-type-classification",
      "pageSequence": [
        {
          "pageIndex": 0,
          "pageName": "Screen name",
          "action": "What user does on this page"
        }
      ],
      "businessValue": "Why testing this flow matters",
      "coverageImpact": 0.0-1.0
    }
  ]
}`;

    try {
      const response = await this.testGenerator.callLLM(prompt);
      const llmResponse = JSON.parse(response);

      // Map LLM flows to our flow sequences
      return llmResponse.flows.map((flow, idx) => {
        const sequence = flowSequences[idx] || flowSequences[0];

        return {
          flow_name: flow.flowName,
          flow_description: flow.flowDescription,
          flow_type: flow.flowType,
          page_sequence: sequence.map(path => ({
            from_page_id: path.from_page_id,
            to_page_id: path.to_page_id,
            screen_name: path.to_screen_name || path.to_url
          })),
          interaction_sequence: sequence.map(path => ({
            element_type: path.element_type,
            selector: path.selector,
            text_content: path.text_content,
            action: this.getActionFromElementType(path.element_type)
          })),
          business_value: flow.businessValue,
          estimated_coverage_impact: flow.coverageImpact
        };
      });

    } catch (error) {
      logger.warn(`LLM flow identification failed: ${error.message}`);
      return this.generateBasicFlows(flowSequences);
    }
  }

  /**
   * Generate basic flows without LLM
   */
  generateBasicFlows(flowSequences) {
    return flowSequences.slice(0, 5).map((sequence, idx) => {
      const startScreen = sequence[0]?.from_screen_name || 'Start';
      const endScreen = sequence[sequence.length - 1]?.to_screen_name || 'End';

      return {
        flow_name: `Flow ${idx + 1}: ${startScreen} to ${endScreen}`,
        flow_description: `User navigates from ${startScreen} through ${sequence.length} pages to ${endScreen}`,
        flow_type: 'navigation',
        page_sequence: sequence.map(path => ({
          from_page_id: path.from_page_id,
          to_page_id: path.to_page_id,
          screen_name: path.to_screen_name || path.to_url
        })),
        interaction_sequence: sequence.map(path => ({
          element_type: path.element_type,
          selector: path.selector,
          text_content: path.text_content,
          action: this.getActionFromElementType(path.element_type)
        })),
        business_value: 'Basic navigation flow',
        estimated_coverage_impact: 0.5
      };
    });
  }

  /**
   * Get action from element type
   */
  getActionFromElementType(elementType) {
    const actionMap = {
      'button': 'click',
      'link': 'click',
      'input': 'fill',
      'select': 'selectOption',
      'checkbox': 'check',
      'radio': 'check'
    };

    return actionMap[elementType] || 'click';
  }

  /**
   * Save user flow to database
   */
  async saveUserFlow(testRunId, flow) {
    const result = await db.query(
      `INSERT INTO user_flows (test_run_id, flow_name, flow_description, flow_type, page_sequence, interaction_sequence, business_value, estimated_coverage_impact)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        testRunId,
        flow.flow_name,
        flow.flow_description,
        flow.flow_type,
        JSON.stringify(flow.page_sequence),
        JSON.stringify(flow.interaction_sequence),
        flow.business_value,
        flow.estimated_coverage_impact
      ]
    );

    return result.rows[0].id;
  }

  /**
   * Generate test case for a flow
   */
  async generateFlowTestCase(testRunId, flowId, flow) {
    const testSteps = flow.interaction_sequence.map((interaction, idx) => {
      const page = flow.page_sequence[idx];
      return {
        step: idx + 1,
        action: interaction.action,
        selector: interaction.selector,
        value: interaction.action === 'fill' ? 'test data' : undefined,
        description: `${interaction.action} ${interaction.element_type}: "${interaction.text_content}"`,
        expectedOutcome: `Navigate to ${page.screen_name}`
      };
    });

    const playwrightCode = this.generateFlowPlaywrightCode(flow);

    await db.query(
      `INSERT INTO test_cases (test_run_id, flow_id, test_type, test_name, test_description, test_steps, expected_result, test_level, playwright_code, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')`,
      [
        testRunId,
        flowId,
        'user-flow',
        flow.flow_name,
        flow.flow_description,
        JSON.stringify(testSteps),
        `Complete ${flow.flow_name} successfully`,
        'flow',
        playwrightCode,
        'pending'
      ]
    );
  }

  /**
   * Generate Playwright code for flow test
   */
  generateFlowPlaywrightCode(flow) {
    const sanitizedName = flow.flow_name.replace(/[^a-zA-Z0-9]/g, '_');

    const stepsCode = flow.interaction_sequence.map((interaction, idx) => {
      const page = flow.page_sequence[idx];
      let code = `\n  // Step ${idx + 1}: ${page.screen_name}\n`;

      switch (interaction.action) {
        case 'click':
          code += `  await page.waitForSelector('${interaction.selector}', { state: 'visible' });\n`;
          code += `  await page.click('${interaction.selector}');\n`;
          code += `  await page.waitForLoadState('networkidle');`;
          break;
        case 'fill':
          code += `  await page.waitForSelector('${interaction.selector}', { state: 'visible' });\n`;
          code += `  await page.fill('${interaction.selector}', 'test data');`;
          break;
        case 'selectOption':
          code += `  await page.selectOption('${interaction.selector}', { index: 1 });`;
          break;
        case 'check':
          code += `  await page.check('${interaction.selector}');`;
          break;
        default:
          code += `  await page.click('${interaction.selector}');`;
      }

      return code;
    }).join('\n');

    return `import { test, expect } from '@playwright/test';

test('${flow.flow_name}', async ({ page }) => {
  // ${flow.flow_description}
  ${stepsCode}

  // Verify flow completed successfully
  // Add custom verification logic here
});`;
  }
}

module.exports = { FlowLevelTestGenerator };
