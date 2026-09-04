import dotenv from 'dotenv';
import { resolve } from 'path';
import { readdir, readFile } from 'fs/promises';
import pool from '../db/pool';

// Load environment variables from backend/.env
dotenv.config({ path: resolve(__dirname, '../../.env') });

const MIGRATIONS_DIR = resolve(__dirname, '../migrations');

async function runMigrations() {
  let client;
  try {
    // Read all files in the migrations directory
    const files = await readdir(MIGRATIONS_DIR);
    // Filter for .sql files and sort alphabetically
    const sqlFiles = files
      .filter(file => file.endsWith('.sql'))
      .sort();

    if (sqlFiles.length === 0) {
      console.log('No migration files found in', MIGRATIONS_DIR);
      process.exit(0);
    }

    console.log(`Found ${sqlFiles.length} migration files to run`);

    // Get a client from the pool and hold it for the entire migration process
    client = await pool.connect();

    for (const file of sqlFiles) {
      const filePath = resolve(MIGRATIONS_DIR, file);
      console.log(`Running migration: ${file}`);

      try {
        const sql = await readFile(filePath, 'utf8');
        // Begin a transaction for this migration file
        await client.query('BEGIN');
        // Execute the migration SQL
        await client.query(sql);
        // Commit the transaction
        await client.query('COMMIT');
        console.log(`✓ Migration ${file} completed successfully`);
      } catch (error) {
        // Rollback the transaction on error
        await client.query('ROLLBACK');
        console.error(`✗ Migration ${file} failed:`);
        console.error(error);
        // Release the client and exit
        client.release();
        process.exit(1);
      }
    }

    console.log('All migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Unexpected error during migration process:', error);
    if (client) {
      client.release();
    }
    process.exit(1);
  }
}

runMigrations();