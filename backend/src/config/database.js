import pg from 'pg';
import env from './env.js';

const { Pool } = pg;

const isTest = process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test';

function createPoolInstance() {
  const p = new Pool({
    connectionString: env.DATABASE_URL,
    max: isTest ? 25 : 20,
    idleTimeoutMillis: isTest ? 2000 : 30000,
    connectionTimeoutMillis: 10000,
  });

  p.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
  });

  return p;
}

let activePool = createPoolInstance();

export function getPool() {
  if (!activePool || activePool.ended) {
    activePool = createPoolInstance();
  }
  return activePool;
}

export const pool = new Proxy({}, {
  get(target, prop) {
    const current = getPool();
    const val = current[prop];
    if (typeof val === 'function') {
      return val.bind(current);
    }
    return val;
  }
});

/**
 * Execute a query against the database
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params) {
  const start = Date.now();
  const currentPool = getPool();
  const result = await currentPool.query(text, params);
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
  return getPool().connect();
}

/**
 * Test database connectivity
 */
export async function testConnection() {
  try {
    const result = await getPool().query('SELECT NOW()');
    console.log('[DB] Connected to PostgreSQL at', result.rows[0].now);
    return true;
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    return false;
  }
}

/**
 * Close database pool
 */
export async function closePool() {
  if (activePool && !activePool.ended) {
    await activePool.end();
  }
}

export default pool;
