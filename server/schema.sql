-- SensuQ Autonomous Testing Engine Database Schema
-- Pure PostgreSQL Database Schema for Production Use

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- LLM Configurations table
CREATE TABLE IF NOT EXISTS llm_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    api_key TEXT, -- Encrypted
    api_url TEXT,
    model_name VARCHAR(255),
    max_tokens INTEGER DEFAULT 4000,
    temperature DECIMAL(3,2) DEFAULT 0.7,
    is_active BOOLEAN DEFAULT false,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Test Configurations table
CREATE TABLE IF NOT EXISTS test_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    target_url TEXT NOT NULL,
    credentials TEXT, -- Encrypted JSON
    max_depth INTEGER DEFAULT 3,
    max_pages INTEGER DEFAULT 50,
    include_accessibility BOOLEAN DEFAULT true,
    include_performance BOOLEAN DEFAULT true,
    llm_config_id INTEGER REFERENCES llm_configs(id),
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Test Runs table
CREATE TABLE IF NOT EXISTS test_runs (
    id SERIAL PRIMARY KEY,
    test_config_id INTEGER REFERENCES test_configs(id),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    total_pages_discovered INTEGER DEFAULT 0,
    total_test_cases INTEGER DEFAULT 0,
    passed_tests INTEGER DEFAULT 0,
    failed_tests INTEGER DEFAULT 0,
    flaky_tests INTEGER DEFAULT 0,
    coverage_percentage DECIMAL(5,2) DEFAULT 0,
    error_message TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Discovered Pages table
CREATE TABLE IF NOT EXISTS discovered_pages (
    id SERIAL PRIMARY KEY,
    test_run_id INTEGER REFERENCES test_runs(id),
    url TEXT NOT NULL,
    title VARCHAR(500),
    elements_count INTEGER DEFAULT 0,
    screenshot_path TEXT,
    crawl_depth INTEGER DEFAULT 0,
    discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Test Cases table
CREATE TABLE IF NOT EXISTS test_cases (
    id SERIAL PRIMARY KEY,
    test_run_id INTEGER REFERENCES test_runs(id),
    page_id INTEGER REFERENCES discovered_pages(id),
    test_type VARCHAR(100) NOT NULL,
    test_name VARCHAR(500) NOT NULL,
    test_description TEXT,
    test_steps JSONB,
    expected_result TEXT,
    actual_result TEXT,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed', 'flaky')),
    execution_time INTEGER DEFAULT 0,
    error_details TEXT,
    self_healed BOOLEAN DEFAULT false,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_test_runs_status ON test_runs(status);
CREATE INDEX IF NOT EXISTS idx_test_runs_created_by ON test_runs(created_by);
CREATE INDEX IF NOT EXISTS idx_test_cases_test_run_id ON test_cases(test_run_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_status ON test_cases(status);
CREATE INDEX IF NOT EXISTS idx_discovered_pages_test_run_id ON discovered_pages(test_run_id);

-- Insert default admin user
-- Password: admin123 (hashed with bcrypt)
INSERT INTO users (email, password_hash, role) 
VALUES ('admin@sensuq.com', '$2b$10$K8jrQZQXQXQXQXQXQXQXQeJ8jrQZQXQXQXQXQXQXQeJ8jrQZQXQXQX', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Update timestamps trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_llm_configs_updated_at BEFORE UPDATE ON llm_configs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_test_configs_updated_at BEFORE UPDATE ON test_configs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

/*
  # Add Image Storage to Database

  1. Schema Changes
    - Add `screenshot_data` column to `discovered_pages` table for base64 image storage
    - Add `image_size` column to track image file size
    - Add `image_format` column to track image format (png, jpg, etc.)
    - Keep existing `screenshot_path` for backward compatibility

  2. Performance Considerations
    - Added index on `test_run_id` for faster image retrieval
    - Base64 storage allows for easy API serving without file system dependencies
*/

-- Add image storage columns to discovered_pages table
ALTER TABLE discovered_pages 
ADD COLUMN IF NOT EXISTS screenshot_data TEXT,
ADD COLUMN IF NOT EXISTS image_size INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS image_format VARCHAR(10) DEFAULT 'png';

-- Add index for better performance when retrieving images by test run
CREATE INDEX IF NOT EXISTS idx_discovered_pages_screenshot_data 
ON discovered_pages(test_run_id) 
WHERE screenshot_data IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN discovered_pages.screenshot_data IS 'Base64 encoded screenshot image data';
COMMENT ON COLUMN discovered_pages.image_size IS 'Size of the original image file in bytes';
COMMENT ON COLUMN discovered_pages.image_format IS 'Image format (png, jpg, jpeg, etc.)';

-- Test Runs table
 CREATE TABLE IF NOT EXISTS test_runs (
     id SERIAL PRIMARY KEY,
     test_config_id INTEGER REFERENCES test_configs(id),
     status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'ready_for_execution', 'executing', 'completed', 'failed', 'cancelled')),
     start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     end_time TIMESTAMP,
     total_pages_discovered INTEGER DEFAULT 0,
     total_test_cases INTEGER DEFAULT 0,
     passed_tests INTEGER DEFAULT 0,
     failed_tests INTEGER DEFAULT 0,
     flaky_tests INTEGER DEFAULT 0,
     coverage_percentage DECIMAL(5,2) DEFAULT 0,
     error_message TEXT,
     created_by INTEGER REFERENCES users(id),
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
 );

 -- Add test_generation_depth column to test_configs table
ALTER TABLE test_configs 
ADD COLUMN IF NOT EXISTS test_generation_depth INTEGER DEFAULT 3;

-- Add comment for documentation
COMMENT ON COLUMN test_configs.test_generation_depth IS 'Number of pages to consider when generating flow-based test cases (default: 3)';

-- Update existing configurations to have the default value
UPDATE test_configs 
SET test_generation_depth = 3 
WHERE test_generation_depth IS NULL;

-- Drop the existing constraint
ALTER TABLE test_runs DROP CONSTRAINT IF EXISTS test_runs_status_check;

-- Add the updated constraint with all required statuses
ALTER TABLE test_runs ADD CONSTRAINT test_runs_status_check 
CHECK (status IN ('pending', 'running', 'ready_for_execution', 'executing', 'completed', 'failed', 'cancelled'));

-- Add comment for documentation
COMMENT ON COLUMN test_runs.status IS 'Current status of the test run: pending -> running -> ready_for_execution -> executing -> completed/failed/cancelled';

-- Add business_context column to test_configs table
ALTER TABLE test_configs 
ADD COLUMN IF NOT EXISTS business_context TEXT;

-- Add comment for documentation
COMMENT ON COLUMN test_configs.business_context IS 'Business/application context to help LLM generate more relevant test cases';

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

