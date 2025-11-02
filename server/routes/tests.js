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

    // Get test cases with page information
    const casesResult = await pool.query(`
      SELECT
        tc.*,
        dp.url as page_url,
        dp.title as page_title,
        dp.screen_name as page_name
      FROM test_cases tc
      LEFT JOIN discovered_pages dp ON tc.page_id = dp.id
      WHERE tc.test_run_id = $1
      ORDER BY dp.screen_name, dp.url, tc.executed_at
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

// Get step results for a test case
router.get('/cases/:id/steps', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT tsr.*
      FROM test_step_results tsr
      JOIN test_cases tc ON tsr.test_case_id = tc.id
      JOIN test_runs tr ON tc.test_run_id = tr.id
      WHERE tsr.test_case_id = $1 AND tr.created_by = $2
      ORDER BY tsr.step_index
    `, [id, req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching test step results:', error);
    res.status(500).json({ error: 'Failed to fetch test step results' });
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

// Get test executions for a test run
router.get('/runs/:id/executions', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT te.*, 
             COUNT(tce.id) as total_test_cases,
             COUNT(CASE WHEN tce.status = 'passed' THEN 1 END) as passed_tests,
             COUNT(CASE WHEN tce.status = 'failed' THEN 1 END) as failed_tests,
             COUNT(CASE WHEN tce.status = 'flaky' THEN 1 END) as flaky_tests,
             COUNT(CASE WHEN tce.status = 'skipped' THEN 1 END) as skipped_tests
      FROM test_executions te
      LEFT JOIN test_case_executions tce ON te.id = tce.test_execution_id
      WHERE te.test_run_id = $1
      GROUP BY te.id
      ORDER BY te.start_time DESC
    `, [id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching test executions:', error);
  }
}
)
router.get('/executions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get execution details
    const executionResult = await pool.query(`
      SELECT te.*, tc.name as config_name, tc.target_url
      FROM test_executions te
      JOIN test_runs tr ON te.test_run_id = tr.id
      JOIN test_configs tc ON tr.test_config_id = tc.id
      WHERE te.id = $1
    `, [id]);

    if (executionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test execution not found' });
    }

    const execution = executionResult.rows[0];

    // Get test case execution results
    const testCaseResults = await pool.query(`
      SELECT tce.*, tc.test_name, tc.test_description, tc.test_type, tc.expected_result, tc.test_steps
      FROM test_case_executions tce
      JOIN test_cases tc ON tce.test_case_id = tc.id
      WHERE tce.test_execution_id = $1
      ORDER BY tce.executed_at
    `, [id]);

    // Format actual results to show simple success/error messages
    const formattedResults = testCaseResults.rows.map(result => {
      let formattedActualResult = result.actual_result;

      // Try to parse JSON and extract meaningful info
      if (result.actual_result) {
        try {
          const parsed = JSON.parse(result.actual_result);

          // Handle array of step results
          if (Array.isArray(parsed)) {
            // Check if all steps passed
            const allPassed = parsed.every(step => step.status === 'passed');

            if (allPassed) {
              formattedActualResult = 'All test steps completed successfully';
            } else {
              // Find the first error
              const errorStep = parsed.find(step => step.status === 'error');
              if (errorStep && errorStep.description) {
                formattedActualResult = errorStep.description;
              } else {
                formattedActualResult = 'Test completed with errors';
              }
            }
          }
          // Handle single result object
          else if (parsed.status === 'passed') {
            formattedActualResult = 'Test verification completed successfully';
          } else if (parsed.errorDetails) {
            formattedActualResult = parsed.errorDetails;
          } else if (parsed.description) {
            formattedActualResult = parsed.description;
          }
        } catch (e) {
          // If not JSON, keep as is
        }
      }

      return {
        ...result,
        actual_result: formattedActualResult
      };
    });

    res.json({
      ...execution,
      testCaseResults: formattedResults
    });
  } catch (error) {
    console.error('Error fetching test execution details:', error);
    res.status(500).json({ error: 'Failed to fetch test execution details' });
  }
});

module.exports = router;