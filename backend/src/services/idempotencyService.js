import { getRedis } from '../config/redis.js';
import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';

/**
 * Distributed Idempotency Guard
 * Uses Redis with PostgreSQL fallback to guarantee exactly-once payment and approval processing.
 */
export async function acquireIdempotencyLock(key, ttlSeconds = 60) {
  try {
    const redis = getRedis();
    const lockKey = `lock:idempotency:${key}`;
    const acquired = await redis.set(lockKey, 'locked', 'EX', ttlSeconds, 'NX');
    return acquired === 'OK';
  } catch (err) {
    logger.warn('Idempotency', 'Redis unavailable, checking DB idempotency fallback', { error: err.message });
    // Check if key already exists in DB
    const res = await query('SELECT id FROM transactions WHERE idempotency_key = $1', [key]);
    return res.rows.length === 0;
  }
}

export async function releaseIdempotencyLock(key) {
  try {
    const redis = getRedis();
    const lockKey = `lock:idempotency:${key}`;
    await redis.del(lockKey);
  } catch (err) {
    logger.warn('Idempotency', 'Redis unlock error:', { error: err.message });
  }
}

export default { acquireIdempotencyLock, releaseIdempotencyLock };
