import { query } from '../config/database.js';
import { getRedis } from '../config/redis.js';
import { logger } from '../utils/logger.js';

/**
 * Authoritative Spend Accounting & Budget Service for AgentPay
 * 
 * Rules:
 * 1. COUNT: successful/captured/verified purchases (status IN ('completed', 'verified', 'payment_completed'))
 *    PLUS active in-flight commitments (purchase_intents with status IN ('allowed', 'approved', 'payment_pending')).
 * 2. DO NOT COUNT: blocked purchases, failed payments, abandoned carts, price-surge blocks, rejected approvals, cancelled unpaid orders.
 * 3. REFUND HANDLING: subtract refunded amounts from spend totals.
 * 4. CALENDAR TIME: strictly calculated against date_trunc('month', CURRENT_TIMESTAMP) and date_trunc('day', CURRENT_TIMESTAMP).
 */

export async function calculateDailySpend(userId, agentId = null, dbQuery = query) {
  if (!userId && !agentId) {
    return { dailySpent: 0, grossSpent: 0, totalRefunded: 0, orderCount: 0 };
  }

  const spendRes = await dbQuery(`
    SELECT 
      COALESCE(SUM(CASE 
        WHEN t.status IN ('completed', 'verified', 'payment_completed') THEN t.amount 
        WHEN t.status = 'refunded' THEN -t.amount 
        ELSE 0 
      END), 0) as total_spent,
      COALESCE(SUM(CASE WHEN t.status IN ('completed', 'verified', 'payment_completed') THEN t.amount ELSE 0 END), 0) as gross_spent,
      COALESCE(SUM(CASE WHEN t.status = 'refunded' THEN t.amount ELSE 0 END), 0) as total_refunded,
      COUNT(CASE WHEN t.status IN ('completed', 'verified', 'payment_completed') THEN 1 END) as order_count
    FROM transactions t
    WHERE (
        ($1::uuid IS NOT NULL AND (t.user_id = $1 OR t.agent_id IN (SELECT id FROM agents WHERE owner_id = $1)))
        OR ($2::uuid IS NOT NULL AND t.agent_id = $2)
      )
      AND t.created_at >= date_trunc('day', CURRENT_TIMESTAMP)
      AND t.status NOT IN ('blocked', 'failed', 'abandoned', 'pending', 'cancelled')
  `, [userId || null, agentId || null]);

  // Include in-flight uncaptured purchase intents from today
  const inFlightRes = await dbQuery(`
    SELECT COALESCE(SUM(pi.amount), 0) as in_flight_amount
    FROM purchase_intents pi
    WHERE (
        ($1::uuid IS NOT NULL AND (pi.user_id = $1 OR pi.agent_id IN (SELECT id FROM agents WHERE owner_id = $1)))
        OR ($2::uuid IS NOT NULL AND pi.agent_id = $2)
      )
      AND pi.created_at >= date_trunc('day', CURRENT_TIMESTAMP)
      AND pi.status IN ('allowed', 'approved', 'payment_pending')
      AND NOT EXISTS (
        SELECT 1 FROM transactions t2 
        WHERE t2.purchase_intent_id = pi.id 
          AND t2.status IN ('completed', 'verified', 'payment_completed')
      )
  `, [userId || null, agentId || null]);

  const settledSpent = Math.max(0, parseFloat(spendRes.rows[0]?.total_spent || 0));
  const inFlightSpent = parseFloat(inFlightRes.rows[0]?.in_flight_amount || 0);
  const dailySpent = settledSpent + inFlightSpent;
  const grossSpent = parseFloat(spendRes.rows[0]?.gross_spent || 0) + inFlightSpent;
  const totalRefunded = parseFloat(spendRes.rows[0]?.total_refunded || 0);
  const orderCount = parseInt(spendRes.rows[0]?.order_count || 0);

  return {
    dailySpent,
    settledSpent,
    inFlightSpent,
    grossSpent,
    totalRefunded,
    orderCount,
  };
}

export async function calculateMonthlySpend(userId, agentId = null, dbQuery = query) {
  if (!userId && !agentId) {
    return { totalSpent: 0, grossSpent: 0, totalRefunded: 0, orderCount: 0 };
  }

  const spendRes = await dbQuery(`
    SELECT 
      COALESCE(SUM(CASE 
        WHEN t.status IN ('completed', 'verified', 'payment_completed') THEN t.amount 
        WHEN t.status = 'refunded' THEN -t.amount 
        ELSE 0 
      END), 0) as total_spent,
      COALESCE(SUM(CASE WHEN t.status IN ('completed', 'verified', 'payment_completed') THEN t.amount ELSE 0 END), 0) as gross_spent,
      COALESCE(SUM(CASE WHEN t.status = 'refunded' THEN t.amount ELSE 0 END), 0) as total_refunded,
      COUNT(CASE WHEN t.status IN ('completed', 'verified', 'payment_completed') THEN 1 END) as order_count
    FROM transactions t
    WHERE (
        ($1::uuid IS NOT NULL AND (t.user_id = $1 OR t.agent_id IN (SELECT id FROM agents WHERE owner_id = $1)))
        OR ($2::uuid IS NOT NULL AND t.agent_id = $2)
      )
      AND t.created_at >= date_trunc('month', CURRENT_TIMESTAMP)
      AND t.status NOT IN ('blocked', 'failed', 'abandoned', 'pending', 'cancelled')
  `, [userId || null, agentId || null]);

  // Include in-flight uncaptured purchase intents to prevent concurrent double-spending
  const inFlightRes = await dbQuery(`
    SELECT COALESCE(SUM(pi.amount), 0) as in_flight_amount
    FROM purchase_intents pi
    WHERE (
        ($1::uuid IS NOT NULL AND (pi.user_id = $1 OR pi.agent_id IN (SELECT id FROM agents WHERE owner_id = $1)))
        OR ($2::uuid IS NOT NULL AND pi.agent_id = $2)
      )
      AND pi.created_at >= date_trunc('month', CURRENT_TIMESTAMP)
      AND pi.status IN ('allowed', 'approved', 'payment_pending')
      AND NOT EXISTS (
        SELECT 1 FROM transactions t2 
        WHERE t2.purchase_intent_id = pi.id 
          AND t2.status IN ('completed', 'verified', 'payment_completed')
      )
  `, [userId || null, agentId || null]);

  const settledTotal = Math.max(0, parseFloat(spendRes.rows[0]?.total_spent || 0));
  const inFlightTotal = parseFloat(inFlightRes.rows[0]?.in_flight_amount || 0);
  const totalSpent = settledTotal + inFlightTotal;
  const grossSpent = parseFloat(spendRes.rows[0]?.gross_spent || 0) + inFlightTotal;
  const totalRefunded = parseFloat(spendRes.rows[0]?.total_refunded || 0);
  const orderCount = parseInt(spendRes.rows[0]?.order_count || 0);

  return {
    totalSpent,
    settledTotal,
    inFlightTotal,
    grossSpent,
    totalRefunded,
    orderCount,
  };
}

export async function getSpendingSummary(userId) {
  if (!userId) {
    return {
      monthlyBudget: 100000,
      spentThisMonth: 0,
      remainingBudget: 100000,
      autoPurchaseLimit: 50000,
      purchaseBehavior: 'auto_within_limit',
      categories: ['Electronics', 'Peripherals'],
      preferredBrands: ['Apple', 'Sony', 'Logitech'],
      policyVersion: 1,
    };
  }

  const prefRes = await query('SELECT * FROM user_preferences WHERE user_id = $1', [userId]);
  let pref = prefRes.rows[0];

  if (!pref) {
    // Insert default preferences if not yet present
    const defRes = await query(`
      INSERT INTO user_preferences (
        user_id, monthly_budget, auto_purchase_limit, categories, preferred_brands, delivery_preference, purchase_behavior, created_at, updated_at
      )
      VALUES ($1, 100000, 50000, ARRAY['Electronics', 'Peripherals', 'Software & Licenses', 'Office Supplies'], ARRAY['Apple', 'Sony', 'ASUS', 'Dell', 'Logitech'], 'Fastest available (within 2 days)', 'auto_within_limit', NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
      RETURNING *
    `, [userId]);
    pref = defRes.rows[0];
  }

  const monthlyBudget = parseFloat(pref.monthly_budget) || 100000;
  const autoPurchaseLimit = parseFloat(pref.auto_purchase_limit) || 50000;
  const { totalSpent, grossSpent, totalRefunded, orderCount } = await calculateMonthlySpend(userId);
  const remainingBudget = Math.max(0, monthlyBudget - totalSpent);

  return {
    monthlyBudget,
    spentThisMonth: totalSpent,
    grossSpent,
    totalRefunded,
    orderCount,
    remainingBudget,
    autoPurchaseLimit,
    purchaseBehavior: pref.purchase_behavior || 'auto_within_limit',
    categories: pref.categories || ['Electronics', 'Peripherals'],
    preferredBrands: pref.preferred_brands || [],
    deliveryPreference: pref.delivery_preference || 'Fastest available (within 2 days)',
    customCriteria: pref.custom_criteria || [],
    naturalLanguageRules: pref.natural_language_rules || [],
    categoryRules: pref.category_rules || {},
    deliveryRules: pref.delivery_rules || {},
    brandRules: pref.brand_rules || {},
    policyVersion: parseInt(pref.policy_version || 1),
  };
}

const localBudgetLocks = new Map();

/**
 * Distributed / In-Memory Budget Mutex Lock to prevent concurrent overspending
 */
export async function acquireBudgetLock(userId, ttlSeconds = 15) {
  if (!userId) return () => {};
  const lockKey = `lock:budget:${userId}`;
  const lockVal = `${Date.now()}_${Math.random()}`;
  const maxWaitMs = ttlSeconds * 1000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const redis = getRedis();
      if (redis && redis.status === 'ready') {
        const acquired = await redis.set(lockKey, lockVal, 'EX', ttlSeconds, 'NX');
        if (acquired) {
          return async () => {
            try {
              const current = await redis.get(lockKey);
              if (current === lockVal) await redis.del(lockKey);
            } catch (e) {}
            localBudgetLocks.delete(userId);
          };
        }
      } else {
        if (!localBudgetLocks.has(userId)) {
          localBudgetLocks.set(userId, lockVal);
          return async () => {
            if (localBudgetLocks.get(userId) === lockVal) {
              localBudgetLocks.delete(userId);
            }
          };
        }
      }
    } catch (err) {
      logger.warn('SpendingService', `Budget lock error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 20));
  }

  return () => {
    localBudgetLocks.delete(userId);
  };
}

export async function releaseBudgetLock(userId) {
  if (!userId) return;
  localBudgetLocks.delete(userId);
  const lockKey = `lock:budget:${userId}`;
  try {
    const redis = getRedis();
    if (redis && redis.status === 'ready') {
      await redis.del(lockKey);
    }
  } catch (err) {
    logger.warn('SpendingService', `Redis release lock error: ${err.message}`);
  }
}

export default {
  calculateDailySpend,
  calculateMonthlySpend,
  getSpendingSummary,
  acquireBudgetLock,
  releaseBudgetLock,
};
