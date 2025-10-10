-- SensuQ Autonomous Testing Engine Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- LLM Configurations table
CREATE TABLE IF NOT EXISTS llm_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(100) NOT NULL, -- 'openai', 'azure', 'anthropic', 'bedrock', 'local'
    api_key TEXT, -- encrypted
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
    credentials TEXT, -- encrypted JSON
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
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed', 'cancelled'
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    total_pages_discovered INTEGER DEFAULT 0,
    total_test_cases INTEGER DEFAULT 0,
    passed_tests INTEGER DEFAULT 0,
    failed_tests INTEGER DEFAULT 0,
    flaky_tests INTEGER DEFAULT 0,
    coverage_percentage DECIMAL(5,2) DEFAULT 0,
    execution_logs TEXT,
    error_message TEXT,
    created_by INTEGER REFERENCES users(id)
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
    test_type VARCHAR(100), -- 'functional', 'accessibility', 'performance'
    test_name VARCHAR(500),
    test_description TEXT,
    test_steps TEXT, -- JSON array
    expected_result TEXT,
    actual_result TEXT,
    status VARCHAR(50), -- 'passed', 'failed', 'skipped'
    execution_time INTEGER, -- milliseconds
    screenshot_path TEXT,
    error_details TEXT,
    self_healed BOOLEAN DEFAULT false,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Test Results table
CREATE TABLE IF NOT EXISTS test_results (
    id SERIAL PRIMARY KEY,
    test_run_id INTEGER REFERENCES test_runs(id),
    summary TEXT,
    detailed_report TEXT, -- JSON
    pdf_report_path TEXT,
    json_report_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_test_runs_status ON test_runs(status);
CREATE INDEX IF NOT EXISTS idx_test_runs_created_by ON test_runs(created_by);
CREATE INDEX IF NOT EXISTS idx_test_cases_test_run_id ON test_cases(test_run_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_status ON test_cases(status);
CREATE INDEX IF NOT EXISTS idx_discovered_pages_test_run_id ON discovered_pages(test_run_id);

-- Insert default admin user (password: admin123)
INSERT INTO users (email, password_hash, role) 
VALUES ('admin@sensuq.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin')
ON CONFLICT (email) DO NOTHING;