const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initializeDatabase() {
  try {
    console.log('Initializing database...');
    
    // Generate proper bcrypt hash for admin123
    const adminPassword = 'admin123';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    
    // Read and execute schema
    const schemaPath = path.join(__dirname, '../schema.sql');
    let schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Replace placeholder hash with actual hash
    schema = schema.replace('$2b$10$K8jrQZQXQXQXQXQXQXQXQeJ8jrQZQXQXQXQXQXQXQeJ8jrQZQXQXQX', hashedPassword);
    
    await pool.query(schema);
    
    console.log('✅ Database initialized successfully!');
    console.log('📊 Tables created:');
    console.log('   - users (with default admin user)');
    console.log('   - llm_configs');
    console.log('   - test_configs');
    console.log('   - test_runs');
    console.log('   - discovered_pages');
    console.log('   - test_cases');
    console.log('');
    console.log('🔐 Default admin credentials:');
    console.log('   Email: admin@sensuq.com');
    console.log('   Password: admin123');
    console.log('');
    console.log('⚠️  Remember to change default credentials in production!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    process.exit(1);
  }
}

initializeDatabase();