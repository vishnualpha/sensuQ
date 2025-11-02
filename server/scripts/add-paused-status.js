const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function addPausedStatus() {
  try {
    console.log('Adding "paused" status to test_runs table...');

    // Drop the existing constraint
    await pool.query(`
      ALTER TABLE test_runs DROP CONSTRAINT IF EXISTS test_runs_status_check;
    `);
    console.log('✓ Dropped existing constraint');

    // Add the new constraint with 'paused' status
    await pool.query(`
      ALTER TABLE test_runs
      ADD CONSTRAINT test_runs_status_check
      CHECK (status IN ('pending', 'running', 'paused', 'ready_for_execution', 'executing', 'completed', 'failed', 'cancelled'));
    `);
    console.log('✓ Added new constraint with "paused" status');

    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Error running migration:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

addPausedStatus();
