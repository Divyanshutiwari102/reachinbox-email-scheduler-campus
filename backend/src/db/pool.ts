import dotenv from 'dotenv';
dotenv.config();
import { Pool } from 'pg';

/**
 * Create a PostgreSQL connection pool
 */
const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  ssl: { rejectUnauthorized: false },
});

// Test the connection (optional but good for debugging)
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('PostgreSQL connection error:', err.stack);
  } else {
    console.log('Connected to PostgreSQL successfully');
  }
});

export default pool;