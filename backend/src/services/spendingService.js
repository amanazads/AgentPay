import { query } from '../config/database.js';
import { getRedis } from '../config/redis.js';
import { logger } from '../utils/logger.js';

/**
 * Authoritative Spend Accounting & Budget Service for AgentPay
 * 
 * Rules:
 * 1. COUNT: successful/captured/verified purchases (status IN ('completed', 'verified', 'payment_completed')).
 * 2. DO NOT COUNT: blocked purchases, failed payments, abandoned carts, price-surge blocks, rejected approvals, cancelled unpaid orders.
 * 3. REFUND HANDLING: subtract refunded amounts from monthly spend.
 * 4. CALENDAR MONTH: strictly calculated against date_trunc('month', CURRENT_DATE).
 */

export async function calculateMonthlySpend(userId) {
  if (!userId) {
    return { totalSpent: 0, grossSpent: 0, totalRefunded: 0, orderCount: 0 };
  }

  const spendRes = await query(`
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
    WHERE (t.user_id = $1 OR t.agent_id IN (SELECT id FROM agents WHERE owner_id = $1))
      AND t.created_at >= date_trunc('month', CURRENT_DATE)
      AND t.status NOT IN ('blocked', 'failed', 'abandoned', 'pending', 'cancelled')
  `, [userId]);

  const rawTotal = parseFloat(spendRes.rows[0]?.total_spent || 0);
  const totalSpent = Math.max(0, rawTotal);
  const grossSpent = parseFloat(spendRes.rows[0]?.gross_spent || 0);
  const totalRefunded = parseFloat(spendRes.rows[0]?.total_refunded || 0);
  const orderCount = parseInt(spendRes.rows[0]?.order_count || 0);

  return {
    totalSpent,
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

/**
 * Distributed Budget Mutex Lock to prevent concurrent overspending
 */
export async function acquireBudgetLock(userId, ttlSeconds = 15) {
  if (!userId) return true;
  const lockKey = `lock:budget:${userId}`;
  const lockVal = `${Date.now()}_${Math.random()}`;

  try {
    const redis = getRedis();
    if (redis && redis.status === 'ready') {
      const acquired = await redis.set(lockKey, lockVal, 'EX', ttlSeconds, 'NX');
      return Boolean(acquired);
    }
  } catch (err) {
    logger.warn('SpendingService', `Redis budget lock error: ${err.message}. Using fallback.`);
  }

  return true;
}

export async function releaseBudgetLock(userId) {
  if (!userId) return;
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
  calculateMonthlySpend,
  getSpendingSummary,
  acquireBudgetLock,
  releaseBudgetLock,
};
