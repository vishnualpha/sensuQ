-- Enhanced Crawling and Flow Tracking for PostgreSQL

-- Page Interactive Elements table
CREATE TABLE IF NOT EXISTS page_interactive_elements (
    id SERIAL PRIMARY KEY,
    page_id INTEGER REFERENCES discovered_pages(id) ON DELETE CASCADE,
    element_type VARCHAR(100) NOT NULL,
    selector TEXT NOT NULL,
    text_content TEXT,
    attributes JSONB DEFAULT '{}',
    position JSONB DEFAULT '{}',
    is_visible BOOLEAN DEFAULT true,
    interaction_priority VARCHAR(50) DEFAULT 'medium' CHECK (interaction_priority IN ('high', 'medium', 'low')),
    identified_by VARCHAR(50) DEFAULT 'vision_llm' CHECK (identified_by IN ('vision_llm', 'dom_parser', 'hybrid')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crawl Paths table
CREATE TABLE IF NOT EXISTS crawl_paths (
    id SERIAL PRIMARY KEY,
    test_run_id INTEGER REFERENCES test_runs(id) ON DELETE CASCADE,
    from_page_id INTEGER REFERENCES discovered_pages(id),
    to_page_id INTEGER REFERENCES discovered_pages(id),
    interaction_element_id INTEGER REFERENCES page_interactive_elements(id),
    interaction_type VARCHAR(50) NOT NULL,
    interaction_details JSONB DEFAULT '{}',
    path_sequence INTEGER NOT NULL,
    depth_level INTEGER NOT NULL,
    is_dead_end BOOLEAN DEFAULT false,
    can_navigate_back BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(test_run_id, from_page_id, to_page_id, interaction_element_id)
);

-- User Flows table
CREATE TABLE IF NOT EXISTS user_flows (
    id SERIAL PRIMARY KEY,
    test_run_id INTEGER REFERENCES test_runs(id) ON DELETE CASCADE,
    flow_name VARCHAR(500) NOT NULL,
    flow_description TEXT,
    flow_type VARCHAR(100),
    page_sequence JSONB NOT NULL,
    interaction_sequence JSONB NOT NULL,
    business_value TEXT,
    estimated_coverage_impact DECIMAL(5,2),
    identified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add screen_name and page_type to discovered_pages
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discovered_pages' AND column_name = 'screen_name'
  ) THEN
    ALTER TABLE discovered_pages ADD COLUMN screen_name VARCHAR(500);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discovered_pages' AND column_name = 'page_type'
  ) THEN
    ALTER TABLE discovered_pages ADD COLUMN page_type VARCHAR(100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discovered_pages' AND column_name = 'page_source'
  ) THEN
    ALTER TABLE discovered_pages ADD COLUMN page_source TEXT;
  END IF;
END $$;

-- Add flow_id and playwright_code to test_cases
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'test_cases' AND column_name = 'flow_id'
  ) THEN
    ALTER TABLE test_cases ADD COLUMN flow_id INTEGER REFERENCES user_flows(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'test_cases' AND column_name = 'playwright_code'
  ) THEN
    ALTER TABLE test_cases ADD COLUMN playwright_code TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'test_cases' AND column_name = 'test_level'
  ) THEN
    ALTER TABLE test_cases ADD COLUMN test_level VARCHAR(50) DEFAULT 'page' CHECK (test_level IN ('page', 'flow'));
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_page_interactive_elements_page_id ON page_interactive_elements(page_id);
CREATE INDEX IF NOT EXISTS idx_page_interactive_elements_element_type ON page_interactive_elements(element_type);
CREATE INDEX IF NOT EXISTS idx_crawl_paths_test_run_id ON crawl_paths(test_run_id);
CREATE INDEX IF NOT EXISTS idx_crawl_paths_from_page_id ON crawl_paths(from_page_id);
CREATE INDEX IF NOT EXISTS idx_crawl_paths_to_page_id ON crawl_paths(to_page_id);
CREATE INDEX IF NOT EXISTS idx_crawl_paths_depth_level ON crawl_paths(depth_level);
CREATE INDEX IF NOT EXISTS idx_user_flows_test_run_id ON user_flows(test_run_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_flow_id ON test_cases(flow_id);

-- Add comments for documentation
COMMENT ON TABLE page_interactive_elements IS 'Interactive elements identified by vision LLM on each page';
COMMENT ON TABLE crawl_paths IS 'Tracks the sequence of pages and interactions during crawling';
COMMENT ON TABLE user_flows IS 'Meaningful user journeys identified across multiple pages';
