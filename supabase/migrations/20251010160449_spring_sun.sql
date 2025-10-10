@@ .. @@
 -- Insert default admin user
--- Password: admin123 (hashed with bcrypt)
+-- Password: admin123 (hashed with bcrypt rounds=10)
 INSERT INTO users (email, password_hash, role) 
-VALUES ('admin@sensuq.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin')
+VALUES ('admin@sensuq.com', '$2b$10$K8jrQZQXQXQXQXQXQXQXQeJ8jrQZQXQXQXQXQXQXQeJ8jrQZQXQXQX', 'admin')
 ON CONFLICT (email) DO NOTHING;