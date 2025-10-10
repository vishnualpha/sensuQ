const express = require('express');
const { Pool } = require('pg');
const { generatePDFReport, generateJSONReport } = require('../services/reportGenerator');

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Generate and download PDF report
router.get('/pdf/:testRunId', async (req, res) => {
  try {
    const { testRunId } = req.params;

    // Get test run data
    const runResult = await pool.query(`
      SELECT tr.*, tc.name as config_name, tc.target_url
      FROM test_runs tr
      JOIN test_configs tc ON tr.test_config_id = tc.id
      WHERE tr.id = $1 AND tr.created_by = $2
    `, [testRunId, req.user.id]);

    if (runResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test run not found' });
    }

    const testRun = runResult.rows[0];

    // Get test cases
    const casesResult = await pool.query(`
      SELECT * FROM test_cases 
      WHERE test_run_id = $1 
      ORDER BY executed_at
    `, [testRunId]);

    const pdfBuffer = await generatePDFReport(testRun, casesResult.rows);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="test-report-${testRunId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generating PDF report:', error);
    res.status(500).json({ error: 'Failed to generate PDF report' });
  }
});

// Generate and download JSON report
router.get('/json/:testRunId', async (req, res) => {
  try {
    const { testRunId } = req.params;

    // Get test run data
    const runResult = await pool.query(`
      SELECT tr.*, tc.name as config_name, tc.target_url
      FROM test_runs tr
      JOIN test_configs tc ON tr.test_config_id = tc.id
      WHERE tr.id = $1 AND tr.created_by = $2
    `, [testRunId, req.user.id]);

    if (runResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test run not found' });
    }

    const testRun = runResult.rows[0];

    // Get discovered pages
    const pagesResult = await pool.query(`
      SELECT * FROM discovered_pages 
      WHERE test_run_id = $1 
      ORDER BY discovered_at
    `, [testRunId]);

    // Get test cases
    const casesResult = await pool.query(`
      SELECT * FROM test_cases 
      WHERE test_run_id = $1 
      ORDER BY executed_at
    `, [testRunId]);

    const jsonReport = generateJSONReport(testRun, pagesResult.rows, casesResult.rows);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="test-report-${testRunId}.json"`);
    res.json(jsonReport);
  } catch (error) {
    console.error('Error generating JSON report:', error);
    res.status(500).json({ error: 'Failed to generate JSON report' });
  }
});

module.exports = router;