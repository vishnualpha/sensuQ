/*
  # Path-Based Crawling and Test Independence

  ## Overview
  This migration enables complete path-based crawling with step sequences and test independence.

  ## Changes Made

  ### 1. Enhanced crawl_paths table
  - Added `complete_step_sequence` - JSONB array storing all steps from base URL to this page
  - Added `session_requirements` - JSONB storing required session state (authenticated, etc.)
  - Each crawl path now contains the full navigation history

  ### 2. Enhanced test_cases table
  - Added `prerequisite_steps` - JSONB array of steps to reach the page from base URL
  - Added `cleanup_steps` - JSONB array of cleanup steps (logout, clear cart, etc.)
  - Tests can now be run independently with proper setup and teardown

  ### 3. New crawl_sessions table
  - Tracks browser session information during crawling
  - Links sessions to depth levels and test runs
  - Enables session management and browser lifecycle tracking

  ### 4. Enhanced page_discovery_queue table
  - Added `required_steps` - JSONB array of steps needed to reach this URL
  - Queue items now know how to navigate to themselves

  ## Migration Details

  ### crawl_paths columns:
  - `complete_step_sequence`: Array of step objects [{action, selector, value, url}, ...]
  - `session_requirements`: {sessionType: 'authenticated', requiredCookies: [...], ...}

  ### test_cases columns:
  - `prerequisite_steps`: Steps to execute before test (navigation from base URL)
  - `cleanup_steps`: Steps to execute after test (cleanup, logout)

  ### crawl_sessions table:
  - `id`: Primary key
  - `test_run_id`: Links to test run
  - `session_type`: Type of session (anonymous, authenticated, etc.)
  - `depth_level`: Which depth level this session was used for
  - `browser_id`: Unique identifier for browser instance
  - `created_at`: When session started
  - `closed_at`: When session ended

  ### page_discovery_queue columns:
  - `required_steps`: JSONB array of steps from base URL to this page
*/

-- Add complete_step_sequence to crawl_paths
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crawl_paths' AND column_name = 'complete_step_sequence'
  ) THEN
    ALTER TABLE crawl_paths ADD COLUMN complete_step_sequence JSONB DEFAULT '[]';
  END IF;
END $$;

-- Add session_requirements to crawl_paths
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crawl_paths' AND column_name = 'session_requirements'
  ) THEN
    ALTER TABLE crawl_paths ADD COLUMN session_requirements JSONB DEFAULT '{}';
  END IF;
END $$;

-- Add prerequisite_steps to test_cases
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'test_cases' AND column_name = 'prerequisite_steps'
  ) THEN
    ALTER TABLE test_cases ADD COLUMN prerequisite_steps JSONB DEFAULT '[]';
  END IF;
END $$;

-- Add cleanup_steps to test_cases
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'test_cases' AND column_name = 'cleanup_steps'
  ) THEN
    ALTER TABLE test_cases ADD COLUMN cleanup_steps JSONB DEFAULT '[]';
  END IF;
END $$;

-- Create crawl_sessions table
CREATE TABLE IF NOT EXISTS crawl_sessions (
  id SERIAL PRIMARY KEY,
  test_run_id INTEGER REFERENCES test_runs(id) ON DELETE CASCADE,
  session_type VARCHAR(50) DEFAULT 'anonymous',
  depth_level INTEGER NOT NULL,
  browser_id VARCHAR(100) NOT NULL,
  session_context JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP
);

-- Add required_steps to page_discovery_queue
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'page_discovery_queue' AND column_name = 'required_steps'
  ) THEN
    ALTER TABLE page_discovery_queue ADD COLUMN required_steps JSONB DEFAULT '[]';
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_crawl_sessions_test_run_id ON crawl_sessions(test_run_id);
CREATE INDEX IF NOT EXISTS idx_crawl_sessions_depth_level ON crawl_sessions(depth_level);
CREATE INDEX IF NOT EXISTS idx_crawl_sessions_browser_id ON crawl_sessions(browser_id);

-- Add comments for documentation
COMMENT ON COLUMN crawl_paths.complete_step_sequence IS 'Full sequence of steps from base URL to this page';
COMMENT ON COLUMN crawl_paths.session_requirements IS 'Required session state (auth, cookies, etc.)';
COMMENT ON COLUMN test_cases.prerequisite_steps IS 'Setup steps to run before test (navigation from base URL)';
COMMENT ON COLUMN test_cases.cleanup_steps IS 'Cleanup steps to run after test (logout, clear state)';
COMMENT ON TABLE crawl_sessions IS 'Tracks browser sessions during crawling';
COMMENT ON COLUMN page_discovery_queue.required_steps IS 'Steps needed to reach this URL from base URL';
