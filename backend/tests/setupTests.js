import { closeRedis } from '../src/config/redis.js';
import { closePool } from '../src/config/database.js';

afterAll(async () => {
  await closeRedis();
  await closePool();
});
