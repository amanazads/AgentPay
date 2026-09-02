import { Router } from 'express';
import { query } from '../config/database.js';
import env from '../config/env.js';
import { getRedisClient } from '../config/redis.js';
import { recordAuditEvent } from '../services/auditService.js';
import { evaluateSystemReadiness } from '../services/systemReadinessService.js';
import { requireAdmin, requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

/**
 * GET /api/system/environment
 * Authoritative backend environment and mode descriptor
 */
router.get('/environment', async (req, res, next) => {
  try {
    const environment = env.APP_ENV.toUpperCase(); // 'DEVELOPMENT' | 'TEST' | 'PRODUCTION'
    const paymentMode = env.PAYMENT_MODE.toUpperCase(); // 'TEST' | 'LIVE'

    res.json({
      environment,
      paymentMode,
      livePaymentsActive: env.livePaymentsActive,
      liveAutonomousCommerceMode: env.LIVE_AUTONOMOUS_COMMERCE_MODE.toUpperCase(),
      platformCaps: {
        maxSingleTransaction: env.PLATFORM_MAX_TRANSACTION_LIMIT,
        maxDailyAutonomousTotal: env.PLATFORM_MAX_DAILY_LIMIT,
        currency: 'INR',
      },
      activeKeyType: env.isLiveMode ? 'RAZORPAY_LIVE' : 'RAZORPAY_TEST_SANDBOX',
      isLiveReady: env.hasLiveRazorpayKeys,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/system/readiness
 * 27-Point Comprehensive Go-Live Gate & Production Readiness Audit
 * Probes runtime conditions, database constraints, credentials, and engines.
 */
router.get('/readiness', async (req, res, next) => {
  try {
    const report = await evaluateSystemReadiness();
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// GET /api/system/status — Dependency health check
//
// Invariant: infrastructure failure MUST NEVER silently convert to a "demo" state.
// This endpoint independently probes each required dependency and reports the
// aggregate system status without any fallback to demo mode.
//
// Response shape:
//   { status: "operational" | "degraded" | "unavailable",
//     dependencies: { database: "ok" | "unavailable", redis: "ok" | "unavailable" },
//     killSwitchActive?: boolean,   // present only when database is reachable
//     environment, paymentMode, timestamp }
//
// HTTP codes:
//   200 — all dependencies healthy (status: "operational")
//   503 — one or more dependencies unavailable (status: "degraded" | "unavailable")
router.get('/status', async (req, res) => {
  const dependencies = {};
  let killSwitchActive;

  // ── 1. PostgreSQL probe ─────────────────────────────────────────────────────
  try {
    const result = await query('SELECT kill_switch_active FROM system_state WHERE id = 1');
    // An empty result means system_state has not been seeded yet — that is not a
    // failure; it just means no kill switch has been configured.
    killSwitchActive = result.rows[0]?.kill_switch_active ?? false;
    dependencies.database = 'ok';
  } catch {
    dependencies.database = 'unavailable';
  }

  // ── 2. Redis probe ──────────────────────────────────────────────────────────
  try {
    const redis = getRedisClient();
    await redis.ping();
    dependencies.redis = 'ok';
  } catch {
    dependencies.redis = 'unavailable';
  }

  // ── 3. Aggregate status ─────────────────────────────────────────────────────
  const dbOk = dependencies.database === 'ok';
  const redisOk = dependencies.redis === 'ok';

  let overallStatus;
  if (dbOk && redisOk) {
    overallStatus = 'operational';
  } else if (!dbOk && !redisOk) {
    overallStatus = 'unavailable';
  } else {
    overallStatus = 'degraded';
  }

  const payload = {
    status: overallStatus,
    environment: env.APP_ENV.toUpperCase(),
    paymentMode: env.PAYMENT_MODE.toUpperCase(),
    dependencies,
    timestamp: new Date().toISOString(),
  };

  // killSwitchActive is only meaningful when the database is reachable
  if (dbOk) {
    payload.killSwitchActive = killSwitchActive;
  }

  const httpStatus = overallStatus === 'operational' ? 200 : 503;
  return res.status(httpStatus).json(payload);
});

// POST /api/system/kill-switch — Emergency freeze (Admin only)
router.post('/kill-switch', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { active, reason } = req.body;
    const io = req.app.get('io');

    await query(`
      INSERT INTO system_state (id, kill_switch_active, kill_switch_activated_by, kill_switch_activated_at, updated_at)
      VALUES (1, $1, $2, CASE WHEN $1 THEN NOW() ELSE NULL END, NOW())
      ON CONFLICT (id) DO UPDATE SET
        kill_switch_active = $1,
        kill_switch_activated_by = $2,
        kill_switch_activated_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
        updated_at = NOW()
    `, [Boolean(active), req.user?.id || null]);

    // Emit live WebSocket event to freeze all connected clients
    if (io) {
      io.emit('kill_switch_changed', { active: Boolean(active), reason });
    }

    await recordAuditEvent({
      eventType: active ? 'GLOBAL_KILL_SWITCH_ACTIVATED' : 'GLOBAL_KILL_SWITCH_DEACTIVATED',
      actor: 'admin',
      action: 'TOGGLE_KILL_SWITCH',
      decision: active ? 'FREEZE' : 'RESTORE',
      reasoning: reason || 'Manual administrative toggle',
      outcome: active ? 'Autonomous purchases halted' : 'Normal operations resumed',
      io,
    });

    res.json({
      success: true,
      killSwitchActive: Boolean(active),
      message: active ? 'Kill switch ACTIVATED. All purchasing blocked.' : 'Kill switch DEACTIVATED. Operations normal.',
    });
  } catch (err) {
    console.error('[KillSwitch Error]:', err);
    next(err);
  }
});

/**
 * POST /api/system/reconcile-orders
 * Run automated multi-point cross-system order state reconciliation
 */
router.post('/reconcile-orders', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { autoHeal = true } = req.body || {};
    const report = await reconcileOrders({ autoHeal });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/system/reconciliation-report
 * Get latest reconciliation diagnostics without mutations
 */
/**
 * POST /api/system/reset-demo & /judge-reset
 * Reset demonstration ledger to pristine state for live technical evaluation
 */
router.post(['/reset-demo', '/judge-reset'], requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const io = req.app.get('io');
    const { resetDemoData } = await import('../services/demoResetService.js');
    const result = await resetDemoData(io);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
