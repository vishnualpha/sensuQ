/*
  # Add self_healed flag to test_step_results

  1. Changes
    - Add `self_healed` boolean column to track if step was healed by self-healing mechanism
    - Defaults to false
  
  2. Purpose
    - Track which individual steps were recovered through self-healing
    - Provide visibility into self-healing effectiveness at step level
*/

-- Add self_healed column to test_step_results
ALTER TABLE test_step_results 
ADD COLUMN IF NOT EXISTS self_healed BOOLEAN DEFAULT false;

-- Add index for queries filtering by self-healed steps
CREATE INDEX IF NOT EXISTS idx_test_step_results_self_healed 
ON test_step_results(self_healed) 
WHERE self_healed = true;
