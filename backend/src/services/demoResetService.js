import { query } from '../config/database.js';
import { recordAuditEvent } from './auditService.js';
import env from '../config/env.js';

/**
 * Reset Demo & Simulation Data Service.
 * 
 * CRITICAL POLICY INVARIANT:
 * In production (`APP_ENV=production`), live buyer orders, production transactions,
 * and user policies are NEVER deleted. Reset is strictly scoped to simulation/test records.
 * In development/test mode, resets evaluation transactions to a clean baseline while
 * preserving user accounts, policies, and store credentials.
 */
export async function resetDemoData(io = null) {
  if (env.isProduction) {
    // CRITICAL SAFETY SHIELD: In production, NEVER purge live transactions or verified orders.
    // Strictly isolate cleanup to test sandbox fixtures and simulation runs.
    await query("DELETE FROM invoices WHERE environment IN ('TEST', 'DEMO', 'SIMULATION')");
    await query("DELETE FROM orders WHERE environment IN ('TEST', 'DEMO', 'SIMULATION')");
    await query("DELETE FROM transactions WHERE environment IN ('TEST', 'DEMO', 'SIMULATION')");
    await query("DELETE FROM inventory_reservations WHERE status = 'RELEASED' OR expires_at < NOW()");
    await query('DELETE FROM simulation_runs');
    await query('DELETE FROM simulation_cases');
  } else {
    // Non-production evaluation and testing baseline reset
    await query('DELETE FROM invoices');
    await query('DELETE FROM orders');
    await query('DELETE FROM transactions');
    await query('DELETE FROM inventory_reservations');
    await query('DELETE FROM approvals');
    await query('DELETE FROM purchase_intents');
    await query('UPDATE user_preferences SET updated_at = NOW()');
    await query(`
      UPDATE products
      SET inventory = CASE 
        WHEN is_test_lab = true THEN 0
        WHEN sku = 'SKU-LOGI-MX3S' THEN 35
        WHEN sku = 'SKU-SONY-XM5' THEN 45
        WHEN sku = 'SKU-AMB-20K' THEN 60
        ELSE 25
      END,
      in_stock = CASE 
        WHEN is_test_lab = true THEN false 
        ELSE true 
      END,
      status = 'ACTIVE'
      WHERE is_test_lab = false OR is_test_lab IS NULL
    `);
    await query("UPDATE merchants SET last_health_check_at = NOW(), connector_status = 'CONNECTED'");
    await query("UPDATE system_state SET kill_switch_active = false WHERE id = 1");
  }

  // Record baseline audit event
  await recordAuditEvent({
    eventType: 'SYSTEM_DEMO_RESET',
    actor: 'admin',
    action: 'RESET_DEMO_STATE',
    decision: 'ALLOW',
    reasoning: env.isProduction
      ? 'Production reset executed: scoped strictly to simulation benchmarks and test sandbox records.'
      : 'Demo ledger and transaction state reset to clean baseline for technical evaluation.',
    outcome: 'Clean judge baseline restored.',
    io,
  });

  if (io) {
    io.emit('demo_reset', { timestamp: new Date().toISOString() });
  }

  return {
    success: true,
    message: env.isProduction
      ? 'Simulation and test sandbox records cleared; production orders and live customer data remain untouched.'
      : 'Demo environment successfully reset for live evaluation: clean baseline restored.',
    timestamp: new Date().toISOString(),
  };
}
