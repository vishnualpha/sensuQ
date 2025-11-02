-- Migration: Add step-level pass/fail tracking
-- Created: 2025-11-02
-- Description: Adds a new table to track individual test step results,
--              allowing detailed visibility into which exact step failed
--              during test execution.

-- Create test_step_results table
CREATE TABLE IF NOT EXISTS test_step_results (
    id SERIAL PRIMARY KEY,
    test_case_id INTEGER REFERENCES test_cases(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    step_action VARCHAR(50) NOT NULL,
    step_selector TEXT,
    step_value TEXT,
    step_description TEXT,
    status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'passed', 'failed', 'skipped')),
    error_message TEXT,
    execution_time INTEGER DEFAULT 0,
    screenshot_path TEXT,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_test_step UNIQUE (test_case_id, step_index)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_test_step_results_test_case_id ON test_step_results(test_case_id);
CREATE INDEX IF NOT EXISTS idx_test_step_results_status ON test_step_results(status);

-- Add comment to table
COMMENT ON TABLE test_step_results IS 'Tracks individual test step execution results for granular failure analysis';
COMMENT ON COLUMN test_step_results.step_index IS 'Zero-based index of the step in the test case';
COMMENT ON COLUMN test_step_results.status IS 'Execution status: pending, passed, failed, or skipped';
