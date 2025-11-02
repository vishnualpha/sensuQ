/*
  # Enhanced Flow Tracking and Pattern Recognition

  1. Changes to user_flows table
    - Add `flow_pattern_type` to classify flow (authentication, checkout, etc.)
    - Add `pattern_confidence` for pattern detection confidence score
    - Add `flow_quality_score` for prioritization
    - Add `journey_type` (linear, circular, repetitive)
    - Add `pages_in_flow` JSONB to store full page sequence
    - Add `success_criteria` JSONB for flow validation
    - Add `estimated_duration_seconds` for test planning
    - Add `priority` for test execution ordering
    - Add `entry_page_url` and `goal_page_url`

  2. Purpose
    - Enable intelligent flow pattern recognition
    - Prioritize test execution by business value
    - Track complete user journeys
    - Store flow metadata for better reporting
    - Support flow quality scoring

  3. Pattern Types
    - authentication, registration, checkout, search
    - crud_create, crud_edit, crud_delete
    - multi_step_form, profile_management, navigation
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_flows' AND column_name = 'flow_pattern_type'
  ) THEN
    ALTER TABLE user_flows ADD COLUMN flow_pattern_type VARCHAR(100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_flows' AND column_name = 'pattern_confidence'
  ) THEN
    ALTER TABLE user_flows ADD COLUMN pattern_confidence DECIMAL(3,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_flows' AND column_name = 'flow_quality_score'
  ) THEN
    ALTER TABLE user_flows ADD COLUMN flow_quality_score INTEGER DEFAULT 0 CHECK (flow_quality_score >= 0 AND flow_quality_score <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_flows' AND column_name = 'journey_type'
  ) THEN
    ALTER TABLE user_flows ADD COLUMN journey_type VARCHAR(50) CHECK (journey_type IN ('linear', 'circular', 'repetitive', 'single-page', 'empty', 'unknown'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_flows' AND column_name = 'pages_in_flow'
  ) THEN
    ALTER TABLE user_flows ADD COLUMN pages_in_flow JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_flows' AND column_name = 'success_criteria'
  ) THEN
    ALTER TABLE user_flows ADD COLUMN success_criteria JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_flows' AND column_name = 'estimated_duration_seconds'
  ) THEN
    ALTER TABLE user_flows ADD COLUMN estimated_duration_seconds INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_flows' AND column_name = 'priority'
  ) THEN
    ALTER TABLE user_flows ADD COLUMN priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_flows' AND column_name = 'entry_page_url'
  ) THEN
    ALTER TABLE user_flows ADD COLUMN entry_page_url TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_flows' AND column_name = 'goal_page_url'
  ) THEN
    ALTER TABLE user_flows ADD COLUMN goal_page_url TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_flows_pattern ON user_flows(flow_pattern_type);
CREATE INDEX IF NOT EXISTS idx_user_flows_priority ON user_flows(priority);
CREATE INDEX IF NOT EXISTS idx_user_flows_quality ON user_flows(flow_quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_user_flows_journey_type ON user_flows(journey_type);

COMMENT ON COLUMN user_flows.flow_pattern_type IS 'Detected pattern type (authentication, checkout, search, etc.)';
COMMENT ON COLUMN user_flows.pattern_confidence IS 'Confidence score (0-1) for pattern detection';
COMMENT ON COLUMN user_flows.flow_quality_score IS 'Quality score (0-100) for test prioritization';
COMMENT ON COLUMN user_flows.journey_type IS 'Type of user journey (linear, circular, etc.)';
COMMENT ON COLUMN user_flows.pages_in_flow IS 'Complete sequence of pages in this flow';
COMMENT ON COLUMN user_flows.success_criteria IS 'Array of criteria for successful flow completion';
COMMENT ON COLUMN user_flows.priority IS 'Business priority for testing (critical, high, medium, low)';
