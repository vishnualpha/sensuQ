const logger = require('../utils/logger');

class SmartFormFiller {
  constructor(authCredentials = {}) {
    this.authCredentials = authCredentials;
    this.testDataPatterns = {
      email: [
        'test.user@example.com',
        'john.doe@test.com',
        'user123@sample.org'
      ],
      password: [
        'SecurePass123!',
        'TestP@ssw0rd',
        'Demo12345!'
      ],
      firstName: ['John', 'Jane', 'Alex', 'Sarah', 'Michael'],
      lastName: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones'],
      username: ['testuser123', 'johndoe', 'user_test', 'demo_user'],
      phone: ['+1-555-0123', '555-123-4567', '(555) 555-0199'],
      company: ['Acme Corp', 'Test Industries', 'Demo Company'],
      address: ['123 Main Street', '456 Oak Avenue', '789 Park Lane'],
      city: ['New York', 'Los Angeles', 'Chicago', 'Houston'],
      zipCode: ['10001', '90001', '60601', '77001'],
      country: ['United States', 'USA', 'US'],
      state: ['CA', 'NY', 'TX', 'FL'],
      url: ['https://example.com', 'https://test.com', 'https://demo.org'],
      number: [25, 100, 1, 50],
      age: [25, 30, 35, 28],
      quantity: [1, 2, 5, 10],
      price: [9.99, 19.99, 49.99, 99.99]
    };
  }

  async analyzeAndFillField(page, fieldSelector, fieldInfo) {
    try {
      const fieldType = await this.detectFieldType(page, fieldSelector, fieldInfo);
      const value = this.generateValueForField(fieldType, fieldInfo);

      logger.info(`  📝 Filling field "${fieldInfo.label || fieldSelector}" with "${value}" (type: ${fieldType})`);

      await this.fillField(page, fieldSelector, fieldType, value, fieldInfo);

      return { success: true, fieldType, value };
    } catch (error) {
      logger.error(`Failed to fill field ${fieldSelector}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async detectFieldType(page, selector, fieldInfo) {
    const element = await page.$(selector);
    if (!element) {
      return 'unknown';
    }

    const tagName = await element.evaluate(el => el.tagName.toLowerCase());
    const type = await element.evaluate(el => el.type?.toLowerCase() || '');
    const name = (fieldInfo.name || '').toLowerCase();
    const label = (fieldInfo.label || '').toLowerCase();
    const placeholder = (fieldInfo.placeholder || '').toLowerCase();
    const id = await element.evaluate(el => el.id?.toLowerCase() || '');

    const context = `${name} ${label} ${placeholder} ${id}`.toLowerCase();

    if (type === 'email' || context.includes('email') || context.includes('e-mail')) {
      return 'email';
    }
    if (type === 'password' || context.includes('password') || context.includes('passwd')) {
      return 'password';
    }
    if (type === 'tel' || context.includes('phone') || context.includes('tel') || context.includes('mobile')) {
      return 'phone';
    }
    if (type === 'url' || context.includes('website') || context.includes('url')) {
      return 'url';
    }
    if (type === 'number' || context.includes('age') || context.includes('quantity')) {
      if (context.includes('age')) return 'age';
      if (context.includes('quantity') || context.includes('qty')) return 'quantity';
      if (context.includes('price') || context.includes('amount')) return 'price';
      return 'number';
    }
    if (type === 'date') {
      return 'date';
    }
    if (tagName === 'select') {
      return 'select';
    }
    if (tagName === 'textarea') {
      return 'textarea';
    }

    if (context.includes('first') && context.includes('name')) return 'firstName';
    if (context.includes('last') && context.includes('name')) return 'lastName';
    if (context.includes('user') && context.includes('name')) return 'username';
    if (context.includes('company') || context.includes('organization')) return 'company';
    if (context.includes('address') || context.includes('street')) return 'address';
    if (context.includes('city')) return 'city';
    if (context.includes('zip') || context.includes('postal')) return 'zipCode';
    if (context.includes('country')) return 'country';
    if (context.includes('state') || context.includes('province')) return 'state';

    return 'text';
  }

  generateValueForField(fieldType, fieldInfo) {
    // Check if this is an auth field and we have credentials
    if (fieldType === 'email' && this.authCredentials.auth_username) {
      return this.authCredentials.auth_username;
    }
    if (fieldType === 'username' && this.authCredentials.auth_username) {
      return this.authCredentials.auth_username;
    }
    if (fieldType === 'password' && this.authCredentials.auth_password) {
      return this.authCredentials.auth_password;
    }

    if (this.testDataPatterns[fieldType]) {
      const values = this.testDataPatterns[fieldType];
      return values[Math.floor(Math.random() * values.length)];
    }

    switch (fieldType) {
      case 'date':
        return this.generateDate();
      case 'textarea':
        return 'This is a test message with some sample content for testing purposes.';
      case 'text':
      default:
        return 'Test Input';
    }
  }

  generateDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async fillField(page, selector, fieldType, value, fieldInfo) {
    const element = await page.$(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    if (fieldType === 'select') {
      await this.fillSelectField(page, selector, element);
    } else {
      await element.click();
      await page.waitForTimeout(200);

      await element.evaluate(el => {
        el.value = '';
      });

      await element.type(value, { delay: 50 });

      await page.waitForTimeout(300);
    }
  }

  async fillSelectField(page, selector, element) {
    const options = await element.evaluate(el => {
      return Array.from(el.options)
        .map((opt, idx) => ({
          index: idx,
          value: opt.value,
          text: opt.text
        }))
        .filter(opt => opt.value !== '');
    });

    if (options.length === 0) {
      logger.warn(`  No valid options found for select field`);
      return;
    }

    const selectedOption = options[Math.floor(Math.random() * options.length)];
    await page.selectOption(selector, { index: selectedOption.index });
    logger.info(`  Selected option: "${selectedOption.text}"`);
  }

  async fillForm(page, formFields) {
    const results = [];

    for (const field of formFields) {
      const result = await this.analyzeAndFillField(page, field.selector, field);
      results.push({ ...field, ...result });
    }

    return results;
  }

  async detectAndFillAllFields(page) {
    const fields = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
      return inputs
        .filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && !el.disabled && !el.readOnly;
        })
        .map((el, idx) => {
          const label = document.querySelector(`label[for="${el.id}"]`)?.textContent || '';
          return {
            selector: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}:nth-of-type(${idx + 1})`,
            name: el.name || '',
            label: label.trim(),
            placeholder: el.placeholder || '',
            type: el.type || el.tagName.toLowerCase()
          };
        });
    });

    logger.info(`  Found ${fields.length} fillable fields on page`);

    return await this.fillForm(page, fields);
  }
}

module.exports = SmartFormFiller;
