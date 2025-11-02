/*
  # Add Virtual Page and State Change Tracking

  1. Changes to discovered_pages
    - Add `is_virtual` flag to distinguish real pages from SPA state changes
    - Add `state_identifier` for unique state identification
    - Add `triggered_by_action` to track what caused the state
    - Add `parent_page_id` to link virtual pages to their base page
    - Add `state_metadata` for storing state details

  2. Changes to interaction_scenarios
    - Add `caused_state_change` flag
    - Add `state_change_type` (modal_opened, content_change, etc.)
    - Add `form_fields_filled` to track form filling data

  3. Purpose
    - Track SPA state changes as virtual pages
    - Enable testing of modal interactions and dynamic content
    - Store form filling intelligence
    - Link state changes to triggering actions
*/

ALTER TABLE discovered_pages
ADD COLUMN IF NOT EXISTS is_virtual BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS state_identifier VARCHAR(255),
ADD COLUMN IF NOT EXISTS triggered_by_action TEXT,
ADD COLUMN IF NOT EXISTS parent_page_id INTEGER REFERENCES discovered_pages(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS state_metadata JSONB;

ALTER TABLE interaction_scenarios
ADD COLUMN IF NOT EXISTS caused_state_change BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS state_change_type VARCHAR(100),
ADD COLUMN IF NOT EXISTS form_fields_filled JSONB;

CREATE INDEX IF NOT EXISTS idx_discovered_pages_virtual ON discovered_pages(is_virtual);
CREATE INDEX IF NOT EXISTS idx_discovered_pages_parent ON discovered_pages(parent_page_id);
CREATE INDEX IF NOT EXISTS idx_discovered_pages_state ON discovered_pages(state_identifier);

COMMENT ON COLUMN discovered_pages.is_virtual IS 'True if this represents an SPA state change rather than a URL navigation';
COMMENT ON COLUMN discovered_pages.state_identifier IS 'Unique identifier for this state (e.g., modal_create_user_abc123)';
COMMENT ON COLUMN discovered_pages.parent_page_id IS 'The base page URL that this virtual state belongs to';
