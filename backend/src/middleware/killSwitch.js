import { query } from '../config/database.js';

/**
 * Kill switch middleware.
 * When the kill switch is active, all financial operations are blocked.
 * Non-financial read operations are still allowed.
 */

// Routes that are blocked when kill switch is active
const BLOCKED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const BLOCKED_PATHS = [
  '/api/purchase-intents',
  '/api/payments',
  '/api/approvals',
];

// Routes that are always allowed (to manage the kill switch itself)
const ALWAYS_ALLOWED = [
  '/api/system/kill-switch',
  '/api/system/resume',
  '/api/system/status',
  '/api/dashboard',
  '/api/audit',
  '/api/agents',
  '/api/products',
  '/api/merchants',
  '/api/simulations',
  '/api/security-tests',
];

export async function killSwitchMiddleware(req, res, next) {
  // Allow GET requests and always-allowed paths
  if (!BLOCKED_METHODS.includes(req.method)) {
    return next();
  }

  const isAlwaysAllowed = ALWAYS_ALLOWED.some((path) =>
    req.path.startsWith(path)
  );
  if (isAlwaysAllowed) {
    return next();
  }

  const isBlockedPath = BLOCKED_PATHS.some((path) =>
    req.path.startsWith(path)
  );
  if (!isBlockedPath) {
    return next();
  }

  try {
    const result = await query(
      'SELECT kill_switch_active FROM system_state WHERE id = 1'
    );

    if (result.rows.length > 0 && result.rows[0].kill_switch_active) {
      return res.status(503).json({
        error: 'KILL_SWITCH_ACTIVE',
        message:
          'Emergency kill switch is active. All financial operations are paused.',
        killSwitchActive: true,
      });
    }
  } catch (err) {
    // If we can't check the kill switch, fail open for now
    // (in production, fail closed)
    console.error('[KillSwitch] Failed to check status:', err.message);
  }

  next();
}

export default killSwitchMiddleware;
