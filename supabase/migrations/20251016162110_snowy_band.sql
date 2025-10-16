/*
  # Add Test Execution History

  1. New Tables
    - `test_executions` - Track individual test execution runs
    - Add indexes for performance

  2. Schema Changes
    - Track execution metadata (browser, environment, etc.)
    - Link executions to test cases and test runs
    - Store execution results and timing data

  3. Features
    - Multiple execution runs per test case
    - Execution history with timestamps
    - Browser-specific results tracking
    - Performance metrics per execution
*/

-- Test Executions table for tracking individual test runs
CREATE TABLE IF NOT EXISTS test_executions (
    id SERIAL PRIMARY KEY,
    test_run_id INTEGER REFERENCES test_runs(id) ON DELETE CASCADE,
    execution_name VARCHAR(255) NOT NULL DEFAULT 'Manual Execution',
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    total_test_cases INTEGER DEFAULT 0,
    passed_tests INTEGER DEFAULT 0,
    failed_tests INTEGER DEFAULT 0,
    flaky_tests INTEGER DEFAULT 0,
    skipped_tests INTEGER DEFAULT 0,
    execution_environment JSONB DEFAULT '{}', -- Browser info, OS, etc.
    executed_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Test Case Executions table for individual test case results within an execution
CREATE TABLE IF NOT EXISTS test_case_executions (
    id SERIAL PRIMARY KEY,
    test_execution_id INTEGER REFERENCES test_executions(id) ON DELETE CASCADE,
    test_case_id INTEGER REFERENCES test_cases(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed', 'flaky', 'skipped')),
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    execution_time INTEGER DEFAULT 0, -- in milliseconds
    browser_results JSONB DEFAULT '[]', -- Results from different browsers
    actual_result TEXT,
    error_details TEXT,
    screenshots JSONB DEFAULT '[]', -- Screenshots taken during execution
    self_healed BOOLEAN DEFAULT false,
    retry_count INTEGER DEFAULT 0,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_test_executions_test_run_id ON test_executions(test_run_id);
CREATE INDEX IF NOT EXISTS idx_test_executions_status ON test_executions(status);
CREATE INDEX IF NOT EXISTS idx_test_executions_executed_by ON test_executions(executed_by);
CREATE INDEX IF NOT EXISTS idx_test_case_executions_test_execution_id ON test_case_executions(test_execution_id);
CREATE INDEX IF NOT EXISTS idx_test_case_executions_test_case_id ON test_case_executions(test_case_id);
CREATE INDEX IF NOT EXISTS idx_test_case_executions_status ON test_case_executions(status);

-- Add comment for documentation
COMMENT ON TABLE test_executions IS 'Tracks individual test execution runs with history';
COMMENT ON TABLE test_case_executions IS 'Stores results of individual test case executions within a test run';