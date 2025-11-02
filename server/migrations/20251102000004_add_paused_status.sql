/*
  # Add Paused Status to Test Runs

  1. Changes
    - Updates the status column constraint in test_runs table to include 'paused' status
    - Allows users to pause crawling and resume later without losing progress

  2. Purpose
    - Enables pause/resume functionality for autonomous crawler
    - Provides better control over long-running crawls
*/

-- Drop the existing constraint
ALTER TABLE test_runs DROP CONSTRAINT IF EXISTS test_runs_status_check;

-- Add the new constraint with 'paused' status
ALTER TABLE test_runs
ADD CONSTRAINT test_runs_status_check
CHECK (status IN ('pending', 'running', 'paused', 'ready_for_execution', 'executing', 'completed', 'failed', 'cancelled'));
