const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigrations() {
  try {
    console.log('Running database migrations...\n');

    const migrationsDir = path.join(__dirname, '../migrations');

    if (!fs.existsSync(migrationsDir)) {
      console.log('No migrations directory found. Skipping migrations.');
      process.exit(0);
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    if (migrationFiles.length === 0) {
      console.log('No migration files found.');
      process.exit(0);
    }

    console.log(`Found ${migrationFiles.length} migration(s):\n`);

    for (const file of migrationFiles) {
      console.log(`📄 Running migration: ${file}`);

      const migrationPath = path.join(migrationsDir, file);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

      try {
        await pool.query(migrationSQL);
        console.log(`✅ Migration ${file} completed successfully\n`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`⏭️  Migration ${file} already applied (tables exist)\n`);
        } else {
          throw error;
        }
      }
    }

    console.log('✅ All migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error running migrations:', error);
    process.exit(1);
  }
}

runMigrations();
