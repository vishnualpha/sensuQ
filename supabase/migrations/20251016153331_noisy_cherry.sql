/*
  # Fix test_runs status check constraint

  1. Schema Changes
    - Update the CHECK constraint on test_runs.status column
    - Add 'ready_for_execution' and 'executing' to allowed statuses
    - Ensure all workflow statuses are properly supported

  2. Allowed Statuses
    - pending: Initial state when test run is created
    - running: When crawler is actively crawling pages
    - ready_for_execution: When crawling/test generation is complete, ready for user to select and run tests
    - executing: When selected tests are being executed
    - completed: When all processes are finished successfully
    - failed: When any process fails
    - cancelled: When user cancels the process
*/

-- Drop the existing constraint
ALTER TABLE test_runs DROP CONSTRAINT IF EXISTS test_runs_status_check;

-- Add the updated constraint with all required statuses
ALTER TABLE test_runs ADD CONSTRAINT test_runs_status_check 
CHECK (status IN ('pending', 'running', 'ready_for_execution', 'executing', 'completed', 'failed', 'cancelled'));

-- Add comment for documentation
COMMENT ON COLUMN test_runs.status IS 'Current status of the test run: pending -> running -> ready_for_execution -> executing -> completed/failed/cancelled';