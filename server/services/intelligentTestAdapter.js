const axios = require('axios');
const logger = require('../utils/logger');
const { decrypt } = require('../utils/encryption');

/**
 * Intelligent Test Adapter - Uses LLM to analyze test failures and suggest fixes
 * Similar to browser-use.com's approach of using AI to adapt when things don't work
 */
class IntelligentTestAdapter {
  constructor(llmConfig) {
    this.config = llmConfig;

    if (llmConfig.api_key) {
      this.apiKey = decrypt(llmConfig.api_key);
      if (!this.apiKey) {
        logger.error('Failed to decrypt LLM API key');
      }
    } else {
      this.apiKey = null;
      logger.warn('No LLM API key provided for intelligent adaptation');
    }

    this.apiUrl = llmConfig.api_url || 'https://api.openai.com/v1/chat/completions';
    this.modelName = llmConfig.model_name || 'gpt-4o';
  }

  /**
   * Analyze a test failure and suggest alternative approaches
   */
  async analyzeFailureAndSuggestFix(failedStep, errorMessage, screenshotBase64, pageSource, intent) {
    if (!this.apiKey) {
      logger.warn('No API key available for intelligent failure analysis');
      return null;
    }

    try {
      logger.info(`🔍 Analyzing test failure with LLM...`);
      logger.info(`Failed step: ${JSON.stringify(failedStep)}`);
      logger.info(`Error: ${errorMessage}`);
      logger.info(`Intent: ${intent}`);

      const prompt = this.buildFailureAnalysisPrompt(failedStep, errorMessage, intent);

      const messages = [
        {
          role: 'system',
          content: 'You are an expert QA automation engineer who specializes in debugging and fixing failed test steps. You analyze screenshots and HTML to understand what went wrong and suggest working alternatives.'
        },
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
          max_tokens: 2000,
          temperature: 0.3
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          timeout: 30000
        }
      );

      let responseText = response.data.choices[0].message.content.trim();
      logger.info('LLM failure analysis received');

      // Remove markdown code blocks if present
      if (responseText.startsWith('```')) {
        responseText = responseText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      }

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('No valid JSON found in LLM response');
        return null;
      }

      const analysis = JSON.parse(jsonMatch[0]);
      logger.info(`✅ LLM suggested fix: ${analysis.suggestedAction}`);

      return analysis;

    } catch (error) {
      logger.error(`Failed to analyze failure with LLM: ${error.message}`);
      return null;
    }
  }

  buildFailureAnalysisPrompt(failedStep, errorMessage, intent) {
    return `# Test Failure Analysis

## What We Tried
**Action:** ${failedStep.action}
**Selector:** ${failedStep.selector || 'N/A'}
**Value:** ${failedStep.value || 'N/A'}
**Intent:** ${intent}

## What Went Wrong
**Error:** ${errorMessage}

## Your Task
Analyze the screenshot and determine:
1. **Why did this fail?** (Is the selector wrong? Is the element not visible? Is it a different element type?)
2. **What should we do instead?** (Different selector? Different action? Click something else first?)
3. **Can we achieve the intent another way?** (Alternative path to accomplish the same goal)

Look at the screenshot carefully:
- Is there a modal/overlay blocking the element?
- Is the element actually visible on screen?
- Does the element look different than expected (e.g., a div styled as button)?
- Is there a search dialog that needs to be filled instead?
- Do we need to click something else first to reveal this element?

## Response Format
Return JSON with this structure:

\`\`\`json
{
  "diagnosis": "Brief explanation of why it failed",
  "rootCause": "The actual problem (e.g., 'Element is readonly and needs to be clicked to open search dialog', 'Selector doesn't exist on page', 'Element hidden behind modal')",
  "canAchieveIntent": true or false,
  "suggestedAction": "What to do next",
  "alternativeSteps": [
    {
      "action": "click|fill|select|wait",
      "selector": "CSS selector to use",
      "value": "value if needed",
      "reason": "Why this should work"
    }
  ],
  "confidence": "high|medium|low"
}
\`\`\`

## Examples

### Example 1: Readonly Field Needs Click
Original: { "action": "fill", "selector": "#fromCity", "value": "Delhi" }
Error: "Element is not editable"

Response:
\`\`\`json
{
  "diagnosis": "The field is readonly and requires clicking to open a search dialog",
  "rootCause": "Input has readonly attribute, clicking it opens an autocomplete/search modal",
  "canAchieveIntent": true,
  "suggestedAction": "Click the field first, then fill the search dialog that appears",
  "alternativeSteps": [
    {
      "action": "click",
      "selector": "#fromCity",
      "reason": "Opens the search dialog"
    },
    {
      "action": "fill",
      "selector": "input[class*='autosuggest']",
      "value": "Delhi",
      "reason": "Fill the search input in the dialog"
    },
    {
      "action": "click",
      "selector": "[class*='option']:first-child",
      "reason": "Select first matching city"
    }
  ],
  "confidence": "high"
}
\`\`\`

### Example 2: Wrong Selector
Original: { "action": "click", "selector": "[aria-label='Login']" }
Error: "Element not found"

Response:
\`\`\`json
{
  "diagnosis": "The selector doesn't exist, but I can see a login element on screen",
  "rootCause": "Element doesn't have aria-label attribute",
  "canAchieveIntent": true,
  "suggestedAction": "Use the correct selector based on what's visible",
  "alternativeSteps": [
    {
      "action": "click",
      "selector": "button.login-btn",
      "reason": "This is the actual login button visible on screen"
    }
  ],
  "confidence": "high"
}
\`\`\`

### Example 3: Modal Blocking
Original: { "action": "click", "selector": "#search-btn" }
Error: "Element not visible"

Response:
\`\`\`json
{
  "diagnosis": "A modal/popup is blocking interaction with the page",
  "rootCause": "Cookie consent or notification modal is overlaying the page",
  "canAchieveIntent": true,
  "suggestedAction": "Dismiss the modal first, then proceed with original action",
  "alternativeSteps": [
    {
      "action": "click",
      "selector": "button[class*='dismiss']",
      "reason": "Close the blocking modal"
    },
    {
      "action": "click",
      "selector": "#search-btn",
      "reason": "Now we can click the search button"
    }
  ],
  "confidence": "high"
}
\`\`\`

Now analyze the provided screenshot and failure details.`;
  }

  /**
   * Execute alternative steps suggested by LLM
   */
  async executeAlternativeSteps(page, alternativeSteps, smartInteractionHandler) {
    logger.info(`🔄 Executing ${alternativeSteps.length} alternative steps from LLM...`);

    for (let i = 0; i < alternativeSteps.length; i++) {
      const step = alternativeSteps[i];
      logger.info(`  Step ${i + 1}: ${step.action} on ${step.selector} - ${step.reason}`);

      try {
        await this.executeAlternativeStep(page, step, smartInteractionHandler);
        logger.info(`  ✅ Step ${i + 1} succeeded`);
        await page.waitForTimeout(1000);
      } catch (error) {
        logger.warn(`  ⚠️ Step ${i + 1} failed: ${error.message}`);
        // Continue with next step anyway - LLM might have provided multiple attempts
      }
    }
  }

  async executeAlternativeStep(page, step, smartInteractionHandler) {
    switch (step.action) {
      case 'click':
        if (smartInteractionHandler) {
          const element = page.locator(step.selector).first();
          await smartInteractionHandler.smartClick(page, element, step.selector);
        } else {
          await page.click(step.selector, { timeout: 5000 });
        }
        break;

      case 'fill':
        if (smartInteractionHandler) {
          const element = page.locator(step.selector).first();
          await smartInteractionHandler.smartFill(page, element, step.selector, step.value, {});
        } else {
          await page.fill(step.selector, step.value, { timeout: 5000 });
        }
        break;

      case 'select':
        if (smartInteractionHandler) {
          const element = page.locator(step.selector).first();
          await smartInteractionHandler.smartSelect(page, element, step.selector, step.value);
        } else {
          await page.selectOption(step.selector, step.value, { timeout: 5000 });
        }
        break;

      case 'wait':
        await page.waitForSelector(step.selector, { timeout: 5000 });
        break;

      default:
        logger.warn(`Unknown alternative action: ${step.action}`);
    }
  }

  /**
   * Verify if the intent was achieved after executing alternatives
   */
  async verifyIntentAchieved(page, intent, screenshotBase64) {
    if (!this.apiKey) {
      return { achieved: false, confidence: 'unknown' };
    }

    try {
      logger.info(`🎯 Verifying if intent was achieved: "${intent}"`);

      const prompt = `Did we successfully achieve this intent: "${intent}"?

Look at the screenshot and determine:
1. Did the expected action happen?
2. Is there visual confirmation of success?
3. Did the page state change as expected?

Respond with JSON:
{
  "achieved": true or false,
  "confidence": "high|medium|low",
  "evidence": "What you see that confirms or denies success",
  "recommendation": "If not achieved, what should we try next"
}`;

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
          max_tokens: 500,
          temperature: 0.3
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          timeout: 20000
        }
      );

      let responseText = response.data.choices[0].message.content.trim();

      if (responseText.startsWith('```')) {
        responseText = responseText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      }

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { achieved: false, confidence: 'unknown' };
      }

      const verification = JSON.parse(jsonMatch[0]);
      logger.info(`${verification.achieved ? '✅' : '❌'} Intent verification: ${verification.evidence}`);

      return verification;

    } catch (error) {
      logger.error(`Failed to verify intent: ${error.message}`);
      return { achieved: false, confidence: 'unknown' };
    }
  }
}

module.exports = IntelligentTestAdapter;
