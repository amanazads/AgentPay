import pg from 'pg';
import env from './env.js';

const { Pool } = pg;

const isTest = process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: isTest ? 5 : 20,
  idleTimeoutMillis: isTest ? 500 : 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * Execute a query against the database
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (env.isDevelopment && duration > 100) {
    console.log(`[DB] Slow query (${duration}ms):`, text.substring(0, 80));
  }
  return result;
}

/**
 * Get a client from the pool (for transactions)
 */
export async function getClient() {
  return pool.connect();
}

/**
 * Test database connectivity
 */
export async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('[DB] Connected to PostgreSQL at', result.rows[0].now);
    return true;
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    return false;
  }
}

export default pool;
