const axios = require('axios');
const logger = require('../utils/logger');
const promptLoader = require('../utils/promptLoader');
const pool = require('../config/database');
const { decrypt } = require('../utils/encryption');

class IntelligentInteractionPlanner {
  constructor(llmConfig) {
    this.config = llmConfig;

    if (llmConfig.api_key) {
      this.apiKey = decrypt(llmConfig.api_key);
      if (!this.apiKey) {
        logger.error('Failed to decrypt LLM API key');
      }
    } else {
      this.apiKey = null;
      logger.warn('No LLM API key provided');
    }

    this.apiUrl = llmConfig.api_url || 'https://api.openai.com/v1/chat/completions';
    this.modelName = llmConfig.model_name || 'gpt-4o';

    logger.info(`IntelligentInteractionPlanner initialized: model=${this.modelName}`);
  }

  async generateScenarios(pageId, testRunId, url, title, screenName, pageType, screenshotBase64, pageSource, interactiveElements) {
    try {
      logger.info(`🧠 Generating interaction scenarios for: ${screenName}`);

      const prompt = await this.buildPrompt(
        url,
        title,
        screenName,
        pageType,
        interactiveElements
      );

      const messages = [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${screenshotBase64}`
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ];

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.modelName,
          messages: messages,
          max_tokens: 4000,
          temperature: 0.7
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      const responseText = response.data.choices[0].message.content;
      logger.info('LLM response received for scenario generation');

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in LLM response');
      }

      const scenarios = JSON.parse(jsonMatch[0]);

      logger.info(`✅ Generated ${scenarios.scenarios.length} interaction scenarios`);

      await this.saveScenarios(pageId, testRunId, scenarios.scenarios);

      return scenarios.scenarios;

    } catch (error) {
      logger.error(`Failed to generate interaction scenarios: ${error.message}`);
      return [];
    }
  }

  async buildPrompt(url, title, screenName, pageType, interactiveElements) {
    let promptTemplate = await promptLoader.loadPrompt('interaction-scenario-generation.txt');

    const elementsFormatted = interactiveElements.map((el, idx) => {
      return `${idx + 1}. ${el.element_type.toUpperCase()} - "${el.text_content || 'no text'}"
   Selector: ${el.selector}
   Priority: ${el.interaction_priority}
   Attributes: ${JSON.stringify(el.attributes)}`;
    }).join('\n\n');

    const businessContext = this.config.business_context || 'General web application';

    promptTemplate = promptTemplate.replace('{url}', url);
    promptTemplate = promptTemplate.replace('{title}', title || 'Unknown');
    promptTemplate = promptTemplate.replace('{screenName}', screenName || 'Unknown Screen');
    promptTemplate = promptTemplate.replace('{pageType}', pageType || 'Unknown');
    promptTemplate = promptTemplate.replace('{businessContext}', businessContext);
    promptTemplate = promptTemplate.replace('{interactiveElements}', elementsFormatted);

    return promptTemplate;
  }

  async saveScenarios(pageId, testRunId, scenarios) {
    for (const scenario of scenarios) {
      try {
        await pool.query(
          `INSERT INTO interaction_scenarios (
            page_id, test_run_id, scenario_name, scenario_description,
            priority, steps, expected_final_outcome, is_testable, leads_to_new_page
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            pageId,
            testRunId,
            scenario.name,
            scenario.description,
            scenario.priority,
            JSON.stringify(scenario.steps),
            scenario.expectedFinalOutcome,
            scenario.isTestable,
            scenario.leadsToNewPage || false
          ]
        );
      } catch (error) {
        logger.error(`Failed to save scenario "${scenario.name}": ${error.message}`);
      }
    }
  }

  async getUnexecutedScenariosForPage(pageId) {
    const result = await pool.query(
      `SELECT * FROM interaction_scenarios
       WHERE page_id = $1 AND executed = false AND is_testable = true
       ORDER BY
         CASE priority
           WHEN 'high' THEN 1
           WHEN 'medium' THEN 2
           WHEN 'low' THEN 3
         END,
         id ASC`,
      [pageId]
    );

    return result.rows;
  }

  async markScenarioExecuted(scenarioId, success, discoveredPageId = null, notes = null) {
    await pool.query(
      `UPDATE interaction_scenarios
       SET executed = true,
           executed_at = CURRENT_TIMESTAMP,
           discovered_page_id = $2,
           execution_notes = $3
       WHERE id = $1`,
      [scenarioId, discoveredPageId, notes]
    );
  }
}

module.exports = IntelligentInteractionPlanner;
