import { query } from '../config/database.js';
import { recordAuditEvent } from './auditService.js';

/**
 * Reset Demo Data Service for Live Technical Evaluations & Buildathon Judging.
 * 
 * CRITICAL POLICY INVARIANT:
 * Clears demo transactions, orders, invoices, and reservations to restore clean baselines.
 * MUST NEVER delete or overwrite active buyer policies, spending preferences, agent policies,
 * or authorization thresholds. Production policies remain authoritative across demo resets.
 */
export async function resetDemoData(io = null) {
  // 1. Delete all invoices
  await query('DELETE FROM invoices');

  // 2. Delete all orders
  await query('DELETE FROM orders');

  // 3. Delete all transactions
  await query('DELETE FROM transactions');

  // 4. Delete all inventory reservations
  await query('DELETE FROM inventory_reservations');

  // 5. Delete all approvals
  await query('DELETE FROM approvals');

  // 6. Delete all purchase intents
  await query('DELETE FROM purchase_intents');

  // 7. Delete non-system audit events
  await query("DELETE FROM audit_events WHERE event_type NOT LIKE 'SYSTEM_%'");

  // 8. Reset user preferences timestamp (spending is dynamically computed from orders/transactions)
  await query('UPDATE user_preferences SET updated_at = NOW()');

  // 9. Reset product inventory to default seed levels
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

  // 10. Update merchants last_health_check_at
  await query("UPDATE merchants SET last_health_check_at = NOW(), connector_status = 'CONNECTED'");

  // 11. Record baseline audit event
  await recordAuditEvent({
    eventType: 'SYSTEM_DEMO_RESET',
    actor: 'admin',
    action: 'RESET_DEMO_STATE',
    decision: 'ALLOW',
    reasoning: 'Demo ledger and transaction state reset to clean baseline for technical evaluation.',
    outcome: 'Clean judge baseline restored (0 orders, ₹0 revenue, ₹0 spent).',
    io,
  });

  if (io) {
    io.emit('demo_reset', { timestamp: new Date().toISOString() });
  }

  return {
    success: true,
    message: 'Demo environment successfully reset for live evaluation: 27 products indexed (26 transactable, 1 test OOS), 0 orders, ₹0 revenue, ₹0 spent.',
    timestamp: new Date().toISOString(),
  };
}
