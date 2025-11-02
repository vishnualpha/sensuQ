/*
  # Add Interaction Scenarios Table

  1. New Table
    - `interaction_scenarios`
      - Stores LLM-generated meaningful interaction sequences for each page
      - Each scenario represents a cohesive user action (e.g., "Add to cart flow", "Login process")
      - Links to pages and contains steps with expected outcomes

  2. Purpose
    - Replace blind element clicking with intelligent, context-aware interaction planning
    - Enable generation of meaningful test cases based on realistic user journeys
    - Track which scenarios lead to new page discoveries

  3. Fields
    - Basic info: page_id, name, description, priority
    - Steps: JSON array of interaction steps with actions, selectors, and expected outcomes
    - Execution tracking: executed, success_rate, leads_to_new_page
    - Test linkage: generated_test_case_id
*/

CREATE TABLE IF NOT EXISTS interaction_scenarios (
    id SERIAL PRIMARY KEY,
    page_id INTEGER REFERENCES discovered_pages(id) ON DELETE CASCADE,
    test_run_id INTEGER REFERENCES test_runs(id) ON DELETE CASCADE,
    scenario_name VARCHAR(500) NOT NULL,
    scenario_description TEXT,
    priority VARCHAR(50) DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
    steps JSONB NOT NULL,
    expected_final_outcome TEXT,
    is_testable BOOLEAN DEFAULT true,
    executed BOOLEAN DEFAULT false,
    leads_to_new_page BOOLEAN DEFAULT false,
    discovered_page_id INTEGER REFERENCES discovered_pages(id) ON DELETE SET NULL,
    generated_test_case_id INTEGER REFERENCES test_cases(id) ON DELETE SET NULL,
    execution_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    executed_at TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_interaction_scenarios_page_id ON interaction_scenarios(page_id);
CREATE INDEX IF NOT EXISTS idx_interaction_scenarios_test_run_id ON interaction_scenarios(test_run_id);
CREATE INDEX IF NOT EXISTS idx_interaction_scenarios_priority ON interaction_scenarios(priority);
CREATE INDEX IF NOT EXISTS idx_interaction_scenarios_executed ON interaction_scenarios(executed);

-- Add comment
COMMENT ON TABLE interaction_scenarios IS 'LLM-generated meaningful interaction sequences for intelligent crawling';
