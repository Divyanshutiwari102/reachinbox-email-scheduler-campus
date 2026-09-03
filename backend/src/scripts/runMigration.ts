import pool from '../db/pool';
import * as fs from 'fs';
import * as path from 'path';

async function runMigration() {
  const sqlPath = path.resolve(__dirname, '../../migrations/002_drop_rate_limit_counters.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration executed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error executing migration:', err);
    throw err;
  } finally {
    client.release();
  }
}

runMigration().then(() => {
  process.exit(0);
}).catch(err => {
  process.exit(1);
});