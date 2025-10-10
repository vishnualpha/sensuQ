const express = require('express');
const { pool } = require('../config/database');

const router = express.Router();

// Get all test runs
router.get('/runs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT tr.*, tc.name as config_name, tc.target_url
      FROM test_runs tr
      JOIN test_configs tc ON tr.test_config_id = tc.id
      WHERE tr.created_by = $1
      ORDER BY tr.start_time DESC
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching test runs:', error);
    res.status(500).json({ error: 'Failed to fetch test runs' });
  }
});

// Get test run details
router.get('/runs/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const runResult = await pool.query(`
      SELECT tr.*, tc.name as config_name, tc.target_url
      FROM test_runs tr
      JOIN test_configs tc ON tr.test_config_id = tc.id
      WHERE tr.id = $1 AND tr.created_by = $2
    `, [id, req.user.id]);

    if (runResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test run not found' });
    }

    const testRun = runResult.rows[0];

    // Get discovered pages
    const pagesResult = await pool.query(`
      SELECT * FROM discovered_pages 
      WHERE test_run_id = $1 
      ORDER BY discovered_at
    `, [id]);

    // Get test cases
    const casesResult = await pool.query(`
      SELECT * FROM test_cases 
      WHERE test_run_id = $1 
      ORDER BY executed_at
    `, [id]);

    res.json({
      ...testRun,
      discoveredPages: pagesResult.rows,
      testCases: casesResult.rows
    });
  } catch (error) {
    console.error('Error fetching test run details:', error);
    res.status(500).json({ error: 'Failed to fetch test run details' });
  }
});

// Get dashboard statistics
router.get('/dashboard/stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_runs,
        COUNT(CASE WHEN status = 'running' THEN 1 END) as active_runs,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_runs,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_runs,
        AVG(CASE WHEN status = 'completed' THEN coverage_percentage END) as avg_coverage,
        SUM(total_test_cases) as total_test_cases,
        SUM(passed_tests) as total_passed,
        SUM(failed_tests) as total_failed,
        SUM(flaky_tests) as total_flaky
      FROM test_runs 
      WHERE created_by = $1
    `, [req.user.id]);

    res.json(stats.rows[0]);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

module.exports = router;