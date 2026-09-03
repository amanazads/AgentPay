import { getRedis } from '../config/redis.js';
import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';

let forceDbFallback = false;

/**
 * Test helper to simulate complete Redis outage
 */
export function setForceDbFallback(val) {
  forceDbFallback = Boolean(val);
}

/**
 * Distributed Idempotency Guard
 * Uses Redis with PostgreSQL ACID fallback to guarantee exactly-once payment and approval processing.
 */
export async function acquireIdempotencyLock(key, ttlSeconds = 60) {
  if (!forceDbFallback) {
    try {
      const redis = getRedis();
      const lockKey = `lock:idempotency:${key}`;
      const acquired = await redis.set(lockKey, 'locked', 'EX', ttlSeconds, 'NX');
      return acquired === 'OK';
    } catch (err) {
      logger.warn('Idempotency', 'Redis unavailable, engaging ACID PostgreSQL fallback', { error: err.message });
    }
  }

  // ACID PostgreSQL Distributed Lock Fallback
  try {
    // 1. If key was already completed in transactions, do not acquire lock
    const txCheck = await query('SELECT id FROM transactions WHERE idempotency_key = $1', [key]);
    if (txCheck.rows.length > 0) {
      return false;
    }

    // 2. Atomic upsert into idempotency_locks table
    const lockRes = await query(`
      INSERT INTO idempotency_locks (lock_key, expires_at)
      VALUES ($1, NOW() + ($2 || ' seconds')::INTERVAL)
      ON CONFLICT (lock_key) DO UPDATE
        SET expires_at = EXCLUDED.expires_at, created_at = NOW()
        WHERE idempotency_locks.expires_at <= NOW()
      RETURNING lock_key
    `, [key, ttlSeconds]);

    return lockRes.rows.length > 0;
  } catch (dbErr) {
    logger.error('Idempotency', 'PostgreSQL lock fallback error', { error: dbErr.message });
    return false;
  }
}

export async function releaseIdempotencyLock(key) {
  try {
    if (!forceDbFallback) {
      const redis = getRedis();
      const lockKey = `lock:idempotency:${key}`;
      await redis.del(lockKey);
    }
  } catch (err) {
    logger.warn('Idempotency', 'Redis unlock error:', { error: err.message });
  }

  // Release DB lock entry if present
  try {
    await query('DELETE FROM idempotency_locks WHERE lock_key = $1', [key]);
  } catch (dbErr) {
    logger.warn('Idempotency', 'PostgreSQL unlock error:', { error: dbErr.message });
  }
}

export default { acquireIdempotencyLock, releaseIdempotencyLock, setForceDbFallback };
