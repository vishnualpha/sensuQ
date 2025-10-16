/*
  # Add Business/App Context to Test Configurations

  1. Schema Changes
    - Add `business_context` column to `test_configs` table for storing application context
    - Add comment for documentation

  2. Purpose
    - Allow users to provide business/application context for better AI test generation
    - Context will be used by LLM to generate more relevant and comprehensive test cases
    - Helps AI understand the purpose and functionality of the application being tested
*/

-- Add business_context column to test_configs table
ALTER TABLE test_configs 
ADD COLUMN IF NOT EXISTS business_context TEXT;

-- Add comment for documentation
COMMENT ON COLUMN test_configs.business_context IS 'Business/application context to help LLM generate more relevant test cases';