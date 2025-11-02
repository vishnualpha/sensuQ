/*
  # Add Page Discovery Queue for Breadth-First Crawling

  1. New Table
    - `page_discovery_queue`
      - Implements breadth-first crawling strategy
      - Pages are queued when discovered and processed level by level
      - Ensures all pages at depth N are visited before depth N+1

  2. Purpose
    - Replace depth-first crawling with breadth-first approach
    - Discover site structure more systematically
    - Enable better flow detection by having complete visibility at each level
    - Allow prioritization within each depth level

  3. Status Flow
    - queued: Page discovered and waiting to be crawled
    - processing: Currently being crawled
    - completed: Successfully crawled
    - failed: Crawl attempt failed

  4. Fields
    - url, depth_level, priority for queue management
    - from_page_id, scenario_id for tracing discovery source
    - status tracking and timestamps
*/

CREATE TABLE IF NOT EXISTS page_discovery_queue (
    id SERIAL PRIMARY KEY,
    test_run_id INTEGER REFERENCES test_runs(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    depth_level INTEGER NOT NULL,
    from_page_id INTEGER REFERENCES discovered_pages(id) ON DELETE SET NULL,
    scenario_id INTEGER REFERENCES interaction_scenarios(id) ON DELETE SET NULL,
    priority VARCHAR(50) DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
    status VARCHAR(50) DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    discovered_page_id INTEGER REFERENCES discovered_pages(id) ON DELETE SET NULL,
    error_message TEXT,
    queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    UNIQUE(test_run_id, url)
);

-- Create indexes for efficient queue processing
CREATE INDEX IF NOT EXISTS idx_queue_status_depth ON page_discovery_queue(status, depth_level, priority);
CREATE INDEX IF NOT EXISTS idx_queue_test_run ON page_discovery_queue(test_run_id);
CREATE INDEX IF NOT EXISTS idx_queue_url ON page_discovery_queue(test_run_id, url);

-- Add comment
COMMENT ON TABLE page_discovery_queue IS 'Breadth-first crawling queue for systematic page discovery';
