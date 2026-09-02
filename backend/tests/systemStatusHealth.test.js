/**
 * System Status Health Check — Regression Suite
 *
 * Invariant under test:
 *   Infrastructure failure MUST NEVER silently convert the application into a
 *   demo/degraded mode by returning `demoMode: true`.
 *
 * Scenarios:
 *   1. Healthy (DB ok, Redis ok)       → HTTP 200, status "operational"
 *   2. DB unavailable                  → HTTP 503, status "degraded"
 *   3. Redis unavailable               → HTTP 503, status "degraded"
 *   4. Both unavailable                → HTTP 503, status "unavailable"
 *   5. DB returns zero rows (unseeded) → HTTP 200, status "operational" (not demoMode)
 *   6. demoMode field is NEVER present in any response shape
 */
import { jest } from '@jest/globals';

// ── Module mocks (must be called before any dynamic imports) ─────────────────

const mockQuery = jest.fn();
jest.unstable_mockModule('../src/config/database.js', () => ({
  query: mockQuery,
  getClient: jest.fn(),
  testConnection: jest.fn(),
  default: null,
}));

const mockPing = jest.fn();
const mockRedisInstance = { ping: mockPing };
const mockGetRedisClient = jest.fn(() => mockRedisInstance);
jest.unstable_mockModule('../src/config/redis.js', () => ({
  getRedis: mockGetRedisClient,
  getRedisClient: mockGetRedisClient,
  testRedisConnection: jest.fn(),
  default: mockGetRedisClient,
}));

// Stub services that system.js imports but are not exercised by /status
jest.unstable_mockModule('../src/services/auditService.js', () => ({
  recordAuditEvent: jest.fn().mockResolvedValue({}),
}));
jest.unstable_mockModule('../src/services/reconciliationService.js', () => ({
  reconcileOrders: jest.fn().mockResolvedValue({}),
}));
jest.unstable_mockModule('../src/middleware/authMiddleware.js', () => ({
  requireAuth: (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
}));

// ── Dynamic imports (after mocks) ─────────────────────────────────────────────
const { default: request } = await import('supertest');
const { default: express } = await import('express');
const { default: systemRoutes } = await import('../src/routes/system.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/system', systemRoutes);
  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockHealthy(killSwitchActive = false) {
  mockQuery.mockResolvedValueOnce({ rows: [{ kill_switch_active: killSwitchActive }] });
  mockPing.mockResolvedValueOnce('PONG');
}

function mockDbDown() {
  mockQuery.mockRejectedValueOnce(new Error('connection refused'));
  mockPing.mockResolvedValueOnce('PONG');
}

function mockRedisDown() {
  mockQuery.mockResolvedValueOnce({ rows: [{ kill_switch_active: false }] });
  mockPing.mockRejectedValueOnce(new Error('Redis ECONNREFUSED'));
}

function mockBothDown() {
  mockQuery.mockRejectedValueOnce(new Error('connection refused'));
  mockPing.mockRejectedValueOnce(new Error('Redis ECONNREFUSED'));
}

function mockDbEmptyRows() {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  mockPing.mockResolvedValueOnce('PONG');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/system/status — Health Check Invariants', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockPing.mockReset();
    mockGetRedisClient.mockReturnValue(mockRedisInstance);
  });

  // Scenario 1: Fully healthy
  describe('Scenario 1 — DB ok, Redis ok', () => {
    test('returns HTTP 200', async () => {
      mockHealthy();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.status).toBe(200);
    });

    test('status field is "operational"', async () => {
      mockHealthy();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.status).toBe('operational');
    });

    test('dependencies object reports both as "ok"', async () => {
      mockHealthy();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.dependencies).toEqual({ database: 'ok', redis: 'ok' });
    });

    test('killSwitchActive reflects DB value', async () => {
      mockHealthy(false);
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body).toHaveProperty('killSwitchActive', false);
    });

    test('response contains environment and paymentMode', async () => {
      mockHealthy();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.environment).toBeDefined();
      expect(res.body.paymentMode).toBeDefined();
    });

    test('INVARIANT: demoMode field is absent from operational response', async () => {
      mockHealthy();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body).not.toHaveProperty('demoMode');
    });
  });

  // Scenario 2: Database unavailable
  describe('Scenario 2 — DB unavailable, Redis ok', () => {
    test('returns HTTP 503', async () => {
      mockDbDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.status).toBe(503);
    });

    test('status field is "degraded"', async () => {
      mockDbDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.status).toBe('degraded');
    });

    test('dependencies.database is "unavailable"', async () => {
      mockDbDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.dependencies.database).toBe('unavailable');
    });

    test('dependencies.redis is "ok" when only DB is down', async () => {
      mockDbDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.dependencies.redis).toBe('ok');
    });

    test('killSwitchActive is absent when DB is unreachable', async () => {
      mockDbDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body).not.toHaveProperty('killSwitchActive');
    });

    test('INVARIANT: demoMode field is absent when DB is down', async () => {
      mockDbDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body).not.toHaveProperty('demoMode');
    });
  });

  // Scenario 3: Redis unavailable
  describe('Scenario 3 — DB ok, Redis unavailable', () => {
    test('returns HTTP 503', async () => {
      mockRedisDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.status).toBe(503);
    });

    test('status field is "degraded"', async () => {
      mockRedisDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.status).toBe('degraded');
    });

    test('dependencies.redis is "unavailable"', async () => {
      mockRedisDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.dependencies.redis).toBe('unavailable');
    });

    test('dependencies.database is "ok" when only Redis is down', async () => {
      mockRedisDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.dependencies.database).toBe('ok');
    });

    test('killSwitchActive is present when DB is reachable', async () => {
      mockRedisDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body).toHaveProperty('killSwitchActive');
    });

    test('INVARIANT: demoMode field is absent when Redis is down', async () => {
      mockRedisDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body).not.toHaveProperty('demoMode');
    });
  });

  // Scenario 4: Both unavailable
  describe('Scenario 4 — DB unavailable, Redis unavailable', () => {
    test('returns HTTP 503', async () => {
      mockBothDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.status).toBe(503);
    });

    test('status field is "unavailable"', async () => {
      mockBothDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.status).toBe('unavailable');
    });

    test('both dependencies are "unavailable"', async () => {
      mockBothDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.dependencies).toEqual({
        database: 'unavailable',
        redis: 'unavailable',
      });
    });

    test('INVARIANT: demoMode field is absent when both dependencies are down', async () => {
      mockBothDown();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body).not.toHaveProperty('demoMode');
    });
  });

  // Scenario 5: DB returns no rows (system_state unseeded)
  describe('Scenario 5 — DB ok but system_state not yet seeded', () => {
    test('returns HTTP 200 (not a failure)', async () => {
      mockDbEmptyRows();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.status).toBe(200);
    });

    test('status field is "operational"', async () => {
      mockDbEmptyRows();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.status).toBe('operational');
    });

    test('killSwitchActive defaults to false (safe default)', async () => {
      mockDbEmptyRows();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.killSwitchActive).toBe(false);
    });

    test('INVARIANT: demoMode field is absent for unseeded system_state', async () => {
      mockDbEmptyRows();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body).not.toHaveProperty('demoMode');
    });
  });

  // Scenario 6: Shape contract
  describe('Scenario 6 — Response shape contract', () => {
    test('every response includes a valid ISO timestamp', async () => {
      mockHealthy();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.timestamp).toBeDefined();
      expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    });

    test('every response includes a dependencies object', async () => {
      mockHealthy();
      const res = await request(createApp()).get('/api/system/status');
      expect(res.body.dependencies).toBeDefined();
      expect(typeof res.body.dependencies).toBe('object');
    });

    test('INVARIANT: demoMode never present in any healthy scenario', async () => {
      const scenarios = [
        () => mockHealthy(),
        () => mockDbEmptyRows(),
      ];
      for (const setup of scenarios) {
        setup();
        const res = await request(createApp()).get('/api/system/status');
        expect(res.body).not.toHaveProperty('demoMode');
        expect(res.body).not.toHaveProperty('demo_mode');
      }
    });
  });
});
