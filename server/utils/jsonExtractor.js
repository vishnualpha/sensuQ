const logger = require('./logger');

/**
 * Robustly extract JSON from LLM responses that may include extra text
 * @param {string} text - Raw text from LLM that may contain JSON
 * @returns {object} - Parsed JSON object
 * @throws {Error} - If no valid JSON can be extracted
 */
function extractJSON(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid input: text must be a non-empty string');
  }

  let cleanedText = text.trim();

  // Remove markdown code blocks if present
  if (cleanedText.startsWith('```')) {
    cleanedText = cleanedText.replace(/^```(?:json|javascript|js)?\s*\n?/i, '');
    cleanedText = cleanedText.replace(/\n?\s*```\s*$/, '');
    cleanedText = cleanedText.trim();
  }

  // Try direct parse first (fastest path)
  try {
    return JSON.parse(cleanedText);
  } catch (directError) {
    // Continue to more aggressive extraction
  }

  // Look for JSON object or array patterns
  const patterns = [
    // Match JSON object
    /\{[\s\S]*\}/,
    // Match JSON array
    /\[[\s\S]*\]/
  ];

  for (const pattern of patterns) {
    const match = cleanedText.match(pattern);
    if (match) {
      try {
        const json = JSON.parse(match[0]);
        logger.debug('Successfully extracted JSON using pattern matching');
        return json;
      } catch (parseError) {
        // Try next pattern
        continue;
      }
    }
  }

  // Try to find the largest valid JSON structure
  const jsonStart = cleanedText.indexOf('{');
  const arrayStart = cleanedText.indexOf('[');

  if (jsonStart === -1 && arrayStart === -1) {
    throw new Error('No JSON structure found in text');
  }

  // Determine which comes first
  const startIndex = jsonStart !== -1 && (arrayStart === -1 || jsonStart < arrayStart)
    ? jsonStart
    : arrayStart;
  const startChar = cleanedText[startIndex];
  const endChar = startChar === '{' ? '}' : ']';

  // Find matching closing bracket, handling strings properly
  let depth = 0;
  let endIndex = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex; i < cleanedText.length; i++) {
    const char = cleanedText[i];

    // Handle escape sequences in strings
    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    // Toggle string state on quotes (not escaped)
    if (char === '"') {
      inString = !inString;
      continue;
    }

    // Only count brackets outside of strings
    if (!inString) {
      if (char === startChar) depth++;
      if (char === endChar) {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }
  }

  if (endIndex === -1) {
    // Try to auto-complete the JSON if we're close to the end
    logger.warn('Incomplete JSON detected - attempting to auto-complete');
    const partialJson = cleanedText.substring(startIndex);

    // Count how many closing brackets we need
    depth = 0;
    inString = false;
    escapeNext = false;

    for (let i = 0; i < partialJson.length; i++) {
      const char = partialJson[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (char === '\\') { escapeNext = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (!inString) {
        if (char === startChar) depth++;
        if (char === endChar) depth--;
      }
    }

    // Add missing closing brackets
    let completedJson = partialJson;
    if (inString) completedJson += '"'; // Close unclosed string
    for (let i = 0; i < depth; i++) {
      completedJson += endChar;
    }

    try {
      const json = JSON.parse(completedJson);
      logger.info('Successfully auto-completed and parsed incomplete JSON');
      return json;
    } catch (completionError) {
      throw new Error('Could not find matching closing bracket for JSON and auto-completion failed');
    }
  }

  const jsonString = cleanedText.substring(startIndex, endIndex + 1);

  try {
    const json = JSON.parse(jsonString);
    logger.debug('Successfully extracted JSON using bracket matching');
    return json;
  } catch (finalError) {
    // Log the problematic text for debugging
    logger.error('Failed to parse JSON. Text sample: ' + cleanedText.substring(0, 200));
    throw new Error(`Failed to extract valid JSON: ${finalError.message}`);
  }
}

/**
 * Try to extract JSON with fallback to default value
 * @param {string} text - Raw text from LLM
 * @param {object} defaultValue - Default value if extraction fails
 * @returns {object} - Parsed JSON or default value
 */
function extractJSONSafe(text, defaultValue = null) {
  try {
    return extractJSON(text);
  } catch (error) {
    logger.warn(`JSON extraction failed: ${error.message}. Using default value.`);
    return defaultValue;
  }
}

module.exports = {
  extractJSON,
  extractJSONSafe
};
