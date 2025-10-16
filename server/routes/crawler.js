const express = require('express');
const { pool } = require('../config/database');
const { PlaywrightCrawler } = require('../services/crawler');

const router = express.Router();

// Start crawling
router.post('/start', async (req, res) => {
  try {
    const { testConfigId } = req.body;

    if (!testConfigId) {
      return res.status(400).json({ error: 'Test configuration ID is required' });
    }

    // Get test configuration
    const configResult = await pool.query(`
      SELECT tc.*, lc.api_key, lc.api_url, lc.provider, lc.model_name
      FROM test_configs tc
      LEFT JOIN llm_configs lc ON tc.llm_config_id = lc.id
      WHERE tc.id = $1 AND tc.created_by = $2
    `, [testConfigId, req.user.id]);

    if (configResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test configuration not found' });
    }

    const config = configResult.rows[0];

    // Create test run
    const runResult = await pool.query(`
      INSERT INTO test_runs (test_config_id, status, created_by)
      VALUES ($1, 'pending', $2)
      RETURNING id
    `, [testConfigId, req.user.id]);

    const testRunId = runResult.rows[0].id;

    // Start crawler
    const crawler = new PlaywrightCrawler(config, testRunId, req.io);
    global.activeCrawlers.set(testRunId, crawler);
    crawler.start();

    res.json({ 
      message: 'Crawling started successfully',
      testRunId: testRunId
    });
  } catch (error) {
    console.error('Error starting crawler:', error);
    res.status(500).json({ error: 'Failed to start crawling' });
  }
});

// Get crawling status
router.get('/status/:testRunId', async (req, res) => {
  try {
    const { testRunId } = req.params;

    const result = await pool.query(`
      SELECT tr.*, tc.name as config_name, tc.target_url
      FROM test_runs tr
      JOIN test_configs tc ON tr.test_config_id = tc.id
      WHERE tr.id = $1 AND tr.created_by = $2
    `, [testRunId, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Test run not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching crawler status:', error);
    res.status(500).json({ error: 'Failed to fetch crawler status' });
  }
});

// Stop crawling
router.post('/stop/:testRunId', async (req, res) => {
  try {
    const { testRunId } = req.params;

    const crawler = global.activeCrawlers.get(parseInt(testRunId));
    if (crawler) {
      await crawler.stopCrawlingAndGenerateTests();
      res.json({ message: 'Crawling stopped and test generation started' });
    } else {
      res.status(404).json({ error: 'Active crawler not found' });
    }
  } catch (error) {
    console.error('Error stopping crawler:', error);
    res.status(500).json({ error: 'Failed to stop crawling' });
  }
});

// Stop crawling and generate tests
router.post('/stop-and-generate/:testRunId', async (req, res) => {
  try {
    const { testRunId } = req.params;

    // Check if test run exists and belongs to user
    const runResult = await pool.query(`
      SELECT status FROM test_runs 
      WHERE id = $1 AND created_by = $2
    `, [testRunId, req.user.id]);

    if (runResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test run not found' });
    }

    const testRun = runResult.rows[0];
    
    if (testRun.status !== 'running') {
      return res.status(400).json({ error: 'Test run is not currently running' });
    }

    const crawler = global.activeCrawlers.get(parseInt(testRunId));
    if (crawler && crawler.isRunning) {
      try {
        await crawler.stopCrawlingAndGenerateTests();
        res.json({ message: 'Crawling stopped and test generation started' });
      } catch (error) {
        console.error('Error stopping crawler:', error);
        res.status(500).json({ error: 'Failed to stop crawling and generate tests' });
      }
    } else {
      // If crawler is not found but test run is running, mark it as completed
      await pool.query(`
        UPDATE test_runs 
        SET status = 'completed', end_time = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [testRunId]);
      
      res.json({ message: 'Test run marked as completed' });
    }
  } catch (error) {
    console.error('Error stopping crawler and generating tests:', error);
    res.status(500).json({ error: 'Failed to stop crawling and generate tests' });
  }
});

// Cancel crawling
router.post('/cancel/:testRunId', async (req, res) => {
  try {
    const { testRunId } = req.params;

    const crawler = global.activeCrawlers.get(parseInt(testRunId));
    if (crawler) {
      await crawler.cleanup();
      global.activeCrawlers.delete(parseInt(testRunId));
    }

    await pool.query(`
      UPDATE test_runs 
      SET status = 'cancelled', end_time = CURRENT_TIMESTAMP
      WHERE id = $1 AND created_by = $2
    `, [testRunId, req.user.id]);

    res.json({ message: 'Crawling stopped successfully' });
  } catch (error) {
    console.error('Error stopping crawler:', error);
    res.status(500).json({ error: 'Failed to stop crawling' });
  }
});

// Execute selected test cases
router.post('/execute/:testRunId', async (req, res) => {
  try {
    const { testRunId } = req.params;
    const { selectedTestCaseIds, executionName } = req.body;

    // Validate test run exists and belongs to user
    const runResult = await pool.query(`
      SELECT status FROM test_runs 
      WHERE id = $1 AND created_by = $2
    `, [testRunId, req.user.id]);

    if (runResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test run not found' });
    }

    const testRun = runResult.rows[0];
    
    if (!['ready_for_execution', 'completed'].includes(testRun.status)) {
      return res.status(400).json({ error: 'Test run is not available for execution' });
    }

    // Create new test execution record
    const executionResult = await pool.query(`
      INSERT INTO test_executions (test_run_id, execution_name, status, executed_by, total_test_cases)
      VALUES ($1, $2, 'running', $3, $4)
      RETURNING id
    `, [testRunId, executionName || 'Manual Execution', req.user.id, selectedTestCaseIds.length]);

    const executionId = executionResult.rows[0].id;
    // Start test execution in background
    const { TestExecutor } = require('../services/testExecutor');
    const executor = new TestExecutor(testRunId, selectedTestCaseIds, executionId, req.io);
    executor.start();

    res.json({ 
      message: 'Test execution started',
      testRunId: testRunId,
      executionId: executionId,
      selectedTests: selectedTestCaseIds.length
    });
  } catch (error) {
    console.error('Error starting test execution:', error);
    res.status(500).json({ error: 'Failed to start test execution' });
  }
});

module.exports = router;