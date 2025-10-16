/*
  # Add test generation depth configuration

  1. Schema Changes
    - Add `test_generation_depth` column to `test_configs` table
    - Set default value to 3 for existing configurations
    - Add comment for documentation

  2. Purpose
    - Allow users to configure how many pages to consider when generating flow-based test cases
    - Default of 3 provides good balance between comprehensive testing and performance
*/

-- Add test_generation_depth column to test_configs table
ALTER TABLE test_configs 
ADD COLUMN IF NOT EXISTS test_generation_depth INTEGER DEFAULT 3;

-- Add comment for documentation
COMMENT ON COLUMN test_configs.test_generation_depth IS 'Number of pages to consider when generating flow-based test cases (default: 3)';

-- Update existing configurations to have the default value
UPDATE test_configs 
SET test_generation_depth = 3 
WHERE test_generation_depth IS NULL;