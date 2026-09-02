import request from 'supertest';
import app from '../src/index.js';
import {
  evaluateSystemReadiness,
  ReadinessStatuses,
} from '../src/services/systemReadinessService.js';
import env from '../src/config/env.js';

describe('Track 01: Truthful 27-Point System Readiness Engine & Gate Verification', () => {
  const allowedStatuses = Object.values(ReadinessStatuses);

  // ── TEST 1: Full 27-Point Audit in Local Test Environment ─────────────────
  test('TEST 1: GET /api/system/readiness executes live probes for all 27 checks with valid schemas', async () => {
    const res = await request(app).get('/api/system/readiness');

    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(27);
    expect(res.body.checklist.length).toBe(27);
    expect(res.body.readinessScore).toBeGreaterThanOrEqual(70);
    expect(res.body.statusCounts).toBeDefined();

    // Verify schema of every single check
    for (const check of res.body.checklist) {
      expect(check.id).toBeDefined();
      expect(check.category).toBeDefined();
      expect(check.title).toBeDefined();
      expect(allowedStatuses).toContain(check.status);
      expect(typeof check.details).toBe('string');
      expect(check.evidence).toBeDefined();
    }

    // Verify specific truthful states
    const dbCheck = res.body.checklist.find((c) => c.id === 'SYS_DB_CONNECTIVITY');
    expect(dbCheck.status).toBe(ReadinessStatuses.READY);
    expect(dbCheck.evidence.connected).toBe(true);

    const carrierCheck = res.body.checklist.find((c) => c.id === 'EXT_CARRIER_FULFILLMENT');
    expect(carrierCheck.status).toBe(ReadinessStatuses.SIMULATED);

    const liveKeysCheck = res.body.checklist.find((c) => c.id === 'PAY_LIVE_CONFIG');
    expect(liveKeysCheck.status).toBe(ReadinessStatuses.NOT_CONFIGURED);
  });

  // ── TEST 2: Missing Redis Simulation ──────────────────────────────────────
  test('TEST 2: Missing Redis marks SYS_REDIS_CONNECTIVITY as DEGRADED with fallback evidence', async () => {
    const mockRedis = {
      ping: async () => {
        throw new Error('Connection refused: Redis offline');
      },
    };

    const report = await evaluateSystemReadiness({ redisOverride: mockRedis });
    const redisCheck = report.checklist.find((c) => c.id === 'SYS_REDIS_CONNECTIVITY');

    expect(redisCheck.status).toBe(ReadinessStatuses.DEGRADED);
    expect(redisCheck.details).toContain('fallback');
    expect(redisCheck.evidence.connected).toBe(false);
  });

  // ── TEST 3: Missing Database Simulation ───────────────────────────────────
  test('TEST 3: Missing Database marks connectivity as BLOCKED and dependents as BLOCKED', async () => {
    const mockDbQuery = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
    };

    const report = await evaluateSystemReadiness({ dbOverride: mockDbQuery });
    const dbCheck = report.checklist.find((c) => c.id === 'SYS_DB_CONNECTIVITY');
    const tableCheck = report.checklist.find((c) => c.id === 'SYS_DB_TABLES');
    const migCheck = report.checklist.find((c) => c.id === 'SYS_DB_MIGRATIONS');

    expect(dbCheck.status).toBe(ReadinessStatuses.BLOCKED);
    expect(dbCheck.evidence.connected).toBe(false);

    expect(tableCheck.status).toBe(ReadinessStatuses.BLOCKED);
    expect(tableCheck.evidence.dbBlocked).toBe(true);

    expect(migCheck.status).toBe(ReadinessStatuses.BLOCKED);
    expect(migCheck.evidence.dbBlocked).toBe(true);
  });

  // ── TEST 4: Missing Live Keys Simulation ──────────────────────────────────
  test('TEST 4: Missing live Razorpay credentials marks PAY_LIVE_CONFIG as NOT_CONFIGURED and locks go-live gate', async () => {
    const mockEnv = {
      ...env,
      RAZORPAY_LIVE_KEY_ID: null,
      RAZORPAY_LIVE_KEY_SECRET: null,
      hasLiveRazorpayKeys: false,
      livePaymentsActive: false,
    };

    const report = await evaluateSystemReadiness({ envOverride: mockEnv });
    const liveCheck = report.checklist.find((c) => c.id === 'PAY_LIVE_CONFIG');

    expect(liveCheck.status).toBe(ReadinessStatuses.NOT_CONFIGURED);
    expect(report.liveGoLiveGateLocked).toBe(true);
    expect(report.goLiveRequirementMet).toBe(false);
  });

  // ── TEST 5: Missing Webhook Secrets Simulation ────────────────────────────
  test('TEST 5: Missing webhook secrets marks PAY_WEBHOOK_CONFIG as NOT_CONFIGURED', async () => {
    const mockEnv = {
      ...env,
      RAZORPAY_TEST_WEBHOOK_SECRET: null,
      RAZORPAY_LIVE_WEBHOOK_SECRET: null,
    };

    const report = await evaluateSystemReadiness({ envOverride: mockEnv });
    const whCheck = report.checklist.find((c) => c.id === 'PAY_WEBHOOK_CONFIG');

    expect(whCheck.status).toBe(ReadinessStatuses.NOT_CONFIGURED);
    expect(whCheck.evidence.testWebhookSecretConfigured).toBe(false);
  });

  // ── TEST 6: Accurate Readiness Percentage Calculation ─────────────────────
  test('TEST 6: Readiness percentage is mathematically calculated from actual READY count', async () => {
    const report = await evaluateSystemReadiness();
    const readyCount = report.statusCounts[ReadinessStatuses.READY];
    const totalCount = report.totalCount;
    const expectedScore = Math.round((readyCount / totalCount) * 100);

    expect(report.readinessScore).toBe(expectedScore);
    expect(report.readyCount).toBe(readyCount);
    expect(report.totalCount).toBe(27);
  });
});
