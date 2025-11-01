const fs = require('fs');
const path = require('path');

class PromptLoader {
  constructor() {
    this.promptsDir = path.join(__dirname, '../prompts');
    this.cache = new Map();
  }

  loadPrompt(filename) {
    if (this.cache.has(filename)) {
      return this.cache.get(filename);
    }

    const filePath = path.join(this.promptsDir, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    this.cache.set(filename, content);
    return content;
  }

  renderPrompt(filename, variables) {
    const template = this.loadPrompt(filename);
    let rendered = template;

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      const stringValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
      rendered = rendered.replace(new RegExp(placeholder, 'g'), stringValue);
    }

    return rendered;
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = new PromptLoader();
