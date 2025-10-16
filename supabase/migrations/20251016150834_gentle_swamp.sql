@@ .. @@
 -- Test Runs table
 CREATE TABLE IF NOT EXISTS test_runs (
     id SERIAL PRIMARY KEY,
     test_config_id INTEGER REFERENCES test_configs(id),
-    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
+    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'ready_for_execution', 'executing', 'completed', 'failed', 'cancelled')),
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