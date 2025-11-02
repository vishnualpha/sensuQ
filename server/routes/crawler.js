const express = require('express');
const { pool } = require('../config/database');
const { AutonomousCrawler } = require('../services/autonomousCrawler');

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

    const testConfig = {
      target_url: configResult.rows[0].target_url,
      max_depth: configResult.rows[0].max_depth || 3,
      max_pages: configResult.rows[0].max_pages || 50,
      credentials: configResult.rows[0].credentials
    };

    const llmConfig = {
      provider: configResult.rows[0].provider,
      api_key: configResult.rows[0].api_key,
      api_url: configResult.rows[0].api_url,
      model_name: configResult.rows[0].model_name
    };

    // Create test run
    const runResult = await pool.query(`
      INSERT INTO test_runs (test_config_id, status, created_by)
      VALUES ($1, 'running', $2)
      RETURNING id
    `, [testConfigId, req.user.id]);

    const testRunId = runResult.rows[0].id;

    // Start autonomous crawler
    const crawler = new AutonomousCrawler(testRunId, testConfig, llmConfig, req.io);
    global.activeCrawlers.set(testRunId, crawler);

    // Start crawling in background
    crawler.start().catch(error => {
      console.error(`Crawler error for test run ${testRunId}:`, error);
      pool.query(`
        UPDATE test_runs
        SET status = 'failed', error_message = $1, end_time = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [error.message, testRunId]);
      global.activeCrawlers.delete(testRunId);
    });

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
      // Call stop method which will update stats and set status
      await crawler.stop();
      await crawler.cleanup();
      global.activeCrawlers.delete(parseInt(testRunId));

      res.json({ message: 'Crawling stopped successfully' });
    } else {
      // Crawler not found in active list, update database
      await pool.query(`
        UPDATE test_runs
        SET status = 'ready_for_execution', end_time = CURRENT_TIMESTAMP
        WHERE id = $1 AND created_by = $2
      `, [testRunId, req.user.id]);

      res.json({ message: 'Crawling stopped successfully' });
    }
  } catch (error) {
    console.error('Error stopping crawler:', error);
    res.status(500).json({ error: 'Failed to stop crawling' });
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

    if (testRun.status === 'running') {
      return res.status(400).json({ error: 'Test run is still in progress. Wait for it to complete before executing tests.' });
    }

    if (testRun.status === 'pending') {
      return res.status(400).json({ error: 'Test run has not started yet.' });
    }

    if (testRun.status === 'failed') {
      return res.status(400).json({ error: 'Test run failed. Cannot execute tests from a failed run.' });
    }

    if (testRun.status === 'cancelled') {
      return res.status(400).json({ error: 'Test run was cancelled.' });
    }

    // Validate that test cases exist
    if (!selectedTestCaseIds || selectedTestCaseIds.length === 0) {
      return res.status(400).json({ error: 'No test cases selected for execution' });
    }

    // Verify test cases belong to this test run
    const validationResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM test_cases
      WHERE test_run_id = $1 AND id = ANY($2)
    `, [testRunId, selectedTestCaseIds]);

    const validCount = parseInt(validationResult.rows[0].count);
    if (validCount !== selectedTestCaseIds.length) {
      return res.status(400).json({
        error: `Some selected test cases do not belong to this test run. Expected ${selectedTestCaseIds.length}, found ${validCount}`
      });
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