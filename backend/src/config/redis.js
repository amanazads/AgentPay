import Redis from 'ioredis';
import env from './env.js';

let redis = null;

export function getRedis() {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 2000);
        return delay;
      },
      lazyConnect: true,
    });

    redis.on('connect', () => {
      console.log('[Redis] Connected');
    });

    redis.on('error', (err) => {
      console.error('[Redis] Error:', err.message);
    });
  }
  return redis;
}

export const getRedisClient = getRedis;

/**
 * Test Redis connectivity
 */
export async function testRedisConnection() {
  try {
    const client = getRedis();
    await client.connect();
    await client.ping();
    console.log('[Redis] Connection verified');
    return true;
  } catch (err) {
    console.error('[Redis] Connection failed:', err.message);
    return false;
  }
}

/**
 * Close Redis connection gracefully
 */
export async function closeRedis() {
  if (redis) {
    try {
      if (redis.status !== 'end') {
        await redis.quit();
      }
    } catch {
      redis.disconnect();
    }
    redis = null;
  }
}

export default getRedis;
