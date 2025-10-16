const express = require('express');
const { pool } = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all LLM configurations
router.get('/llm', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, provider, api_url, model_name, max_tokens, temperature, is_active, created_at
      FROM llm_configs 
      ORDER BY created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching LLM configs:', error);
    res.status(500).json({ error: 'Failed to fetch LLM configurations' });
  }
});

// Create LLM configuration
router.post('/llm', requireAdmin, async (req, res) => {
  try {
    const { name, provider, apiKey, apiUrl, modelName, maxTokens, temperature } = req.body;

    if (!name || !provider) {
      return res.status(400).json({ error: 'Name and provider are required' });
    }

    const encryptedApiKey = apiKey ? encrypt(apiKey) : null;

    const result = await pool.query(`
      INSERT INTO llm_configs (name, provider, api_key, api_url, model_name, max_tokens, temperature, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, name, provider, api_url, model_name, max_tokens, temperature, is_active, created_at
    `, [name, provider, encryptedApiKey, apiUrl, modelName, maxTokens || 4000, temperature || 0.7, req.user.id]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating LLM config:', error);
    res.status(500).json({ error: 'Failed to create LLM configuration' });
  }
});

// Update LLM configuration
router.put('/llm/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, provider, apiKey, apiUrl, modelName, maxTokens, temperature, isActive } = req.body;

    const encryptedApiKey = apiKey ? encrypt(apiKey) : null;

    const result = await pool.query(`
      UPDATE llm_configs 
      SET name = $1, provider = $2, api_key = $3, api_url = $4, model_name = $5, 
          max_tokens = $6, temperature = $7, is_active = $8, updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING id, name, provider, api_url, model_name, max_tokens, temperature, is_active, updated_at
    `, [name, provider, encryptedApiKey, apiUrl, modelName, maxTokens, temperature, isActive, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'LLM configuration not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating LLM config:', error);
    res.status(500).json({ error: 'Failed to update LLM configuration' });
  }
});

// Delete LLM configuration
router.delete('/llm/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM llm_configs WHERE id = $1', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'LLM configuration not found' });
    }

    res.json({ message: 'LLM configuration deleted successfully' });
  } catch (error) {
    console.error('Error deleting LLM config:', error);
    res.status(500).json({ error: 'Failed to delete LLM configuration' });
  }
});

// Get test configurations
router.get('/test', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT tc.*, lc.name as llm_name, lc.provider as llm_provider
      FROM test_configs tc
      LEFT JOIN llm_configs lc ON tc.llm_config_id = lc.id
      WHERE tc.created_by = $1
      ORDER BY tc.created_at DESC
    `, [req.user.id]);

    const configs = result.rows.map(config => ({
      ...config,
      credentials: config.credentials ? JSON.parse(decrypt(config.credentials)) : null
    }));

    res.json(configs);
  } catch (error) {
    console.error('Error fetching test configs:', error);
    res.status(500).json({ error: 'Failed to fetch test configurations' });
  }
});

// Create test configuration
router.post('/test', async (req, res) => {
  try {
    const { name, targetUrl, credentials, maxDepth, maxPages, includeAccessibility, includePerformance, llmConfigId, testGenerationDepth } = req.body;

    if (!name || !targetUrl) {
      return res.status(400).json({ error: 'Name and target URL are required' });
    }

    const encryptedCredentials = credentials ? encrypt(JSON.stringify(credentials)) : null;

    const result = await pool.query(`
      INSERT INTO test_configs (name, target_url, credentials, max_depth, max_pages, 
                               include_accessibility, include_performance, llm_config_id, created_by, test_generation_depth)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [name, targetUrl, encryptedCredentials, maxDepth || 3, maxPages || 50, 
        includeAccessibility !== false, includePerformance !== false, llmConfigId, req.user.id, testGenerationDepth || 3]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating test config:', error);
    res.status(500).json({ error: 'Failed to create test configuration' });
  }
});

module.exports = router;