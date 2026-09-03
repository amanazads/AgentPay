import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { getSpendingSummary, calculateMonthlySpend, calculateDailySpend } from './spendingService.js';
import { merchantConnectionService } from './merchantConnectionService.js';
import { paymentMethodService } from './paymentMethodService.js';
import { calculatePrice } from './pricingService.js';
import env from '../config/env.js';

/**
 * Deterministic Policy Engine for AgentPay
 * 
 * CORE PRINCIPLE:
 * Buyer Preferences define the boundaries of autonomous purchasing.
 * AI may optimize WITHIN those boundaries. AI may NEVER override them.
 * LLM is NEVER the final authority for financial policy.
 */

export async function evaluatePolicy({
  agentId,
  userId,
  intentId,
  productId,
  merchantId,
  amount,
  quantity = 1,
  deliveryFee = 0,
  deliveryDays = null,
  idempotencyKey,
  quotePrice = null,
}) {
  const startTime = Date.now();
  const rulesEvaluated = [];
  const violatedRules = [];

  // 1. Check Global Emergency Kill Switch
  const systemRes = await query('SELECT kill_switch_active FROM system_state WHERE id = 1');
  const killSwitchActive = systemRes.rows[0]?.kill_switch_active || false;
  rulesEvaluated.push({
    rule: 'KILL_SWITCH',
    passed: !killSwitchActive,
    details: killSwitchActive ? 'Emergency kill switch is active' : 'Kill switch is inactive',
  });

  if (killSwitchActive) {
    return {
      decision: 'BLOCK',
      rule: 'KILL_SWITCH_ACTIVE',
      reason: 'Emergency kill switch is active. All automated spending is paused.',
      rulesEvaluated,
      violatedRules: ['KILL_SWITCH_ACTIVE'],
      policyVersion: 'global',
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 2. Fetch Agent & Spending Policy Details
  let agent = null;
  let policyVersion = 'v1';

  if (agentId) {
    const agentRes = await query(`
      SELECT a.id, a.name, a.status, a.policy_id, a.owner_id,
             p.name as policy_name, p.version as policy_version,
             p.daily_budget, p.max_transaction, p.approval_threshold,
             p.allowed_categories, p.blocked_categories,
             p.max_retries, p.price_tolerance_pct, p.verified_merchants_only
      FROM agents a
      JOIN policies p ON a.policy_id = p.id
      WHERE a.id = $1
    `, [agentId]);

    if (agentRes.rows.length > 0) {
      agent = agentRes.rows[0];
      policyVersion = agent.policy_version || 'v1';
      if (!userId && agent.owner_id) {
        userId = agent.owner_id;
      }
    }
  }

  if (!agent) {
    // Default fallback agent configuration if running purely buyer-directed
    agent = {
      name: 'Autonomous Buyer Agent',
      status: 'active',
      daily_budget: 100000,
      max_transaction: 100000,
      approval_threshold: 50000,
      allowed_categories: [],
      blocked_categories: [],
      price_tolerance_pct: 2.0,
      verified_merchants_only: true,
    };
  }

  // 3. Agent Status Check
  const isAgentActive = agent.status === 'active';
  rulesEvaluated.push({
    rule: 'AGENT_STATUS',
    passed: isAgentActive,
    details: `Agent status is '${agent.status}'`,
  });

  if (!isAgentActive) {
    violatedRules.push('AGENT_DISABLED');
    return {
      decision: 'BLOCK',
      rule: 'AGENT_DISABLED',
      reason: `Agent '${agent.name}' is currently disabled (${agent.status}). Financial transactions are prohibited.`,
      rulesEvaluated,
      violatedRules,
      policyVersion,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 4. Fetch Authoritative Buyer Spending Preferences from Database
  let buyerPolicy = null;
  if (userId) {
    buyerPolicy = await getSpendingSummary(userId);
  } else {
    buyerPolicy = {
      monthlyBudget: 100000,
      spentThisMonth: 0,
      remainingBudget: 100000,
      autoPurchaseLimit: 50000,
      purchaseBehavior: 'auto_within_limit',
      categories: ['Electronics', 'Peripherals', 'Software & Licenses', 'Office Supplies'],
      preferredBrands: [],
      categoryRules: {},
      deliveryRules: {},
      brandRules: {},
      policyVersion: 1,
    };
  }

  // 5. Fetch Product & Merchant Details
  const productRes = await query(`
    SELECT p.*, m.name as merchant_name, m.is_verified, m.risk_level
    FROM products p
    JOIN merchants m ON p.merchant_id = m.id
    WHERE p.id = $1
  `, [productId]);

  if (productRes.rows.length === 0) {
    return {
      decision: 'BLOCK',
      rule: 'PRODUCT_NOT_FOUND',
      reason: 'Product not found in verified merchant catalog',
      rulesEvaluated,
      violatedRules: ['PRODUCT_NOT_FOUND'],
      policyVersion,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  const product = productRes.rows[0];

  // 6. Product Availability & Inventory Check
  const availableInventory = parseInt(product.inventory ?? 0, 10);
  const requestedQty = Math.max(1, parseInt(quantity, 10) || 1);
  const isAvailable = Boolean(product.in_stock && availableInventory >= requestedQty);

  rulesEvaluated.push({
    rule: 'PRODUCT_AVAILABILITY',
    passed: isAvailable,
    details: !product.in_stock
      ? 'Product is out of stock'
      : availableInventory < requestedQty
      ? `Insufficient inventory (${availableInventory} available, ${requestedQty} requested)`
      : `Product is in stock with sufficient inventory (${availableInventory} available)`,
  });

  if (!product.in_stock) {
    violatedRules.push('OUT_OF_STOCK');
    return {
      decision: 'BLOCK',
      rule: 'OUT_OF_STOCK',
      reason: `Product '${product.name}' is currently out of stock`,
      rulesEvaluated,
      violatedRules,
      policyVersion,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  if (availableInventory < requestedQty) {
    violatedRules.push('INSUFFICIENT_INVENTORY');
    return {
      decision: 'BLOCK',
      rule: 'INSUFFICIENT_INVENTORY',
      reason: `Insufficient inventory for product '${product.name}' (${availableInventory} available, ${requestedQty} requested).`,
      rulesEvaluated,
      violatedRules,
      policyVersion,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 7. Permitted Categories Check (Hard Policy Boundary)
  const productCat = (product.category || '').toLowerCase();
  const buyerAllowedCats = (buyerPolicy.categories || []).map((c) => c.toLowerCase());
  const agentAllowedCats = (agent.allowed_categories || []).map((c) => c.toLowerCase());
  const agentBlockedCats = (agent.blocked_categories || []).map((c) => c.toLowerCase());

  const isBlockedByAgent = agentBlockedCats.includes(productCat);
  const isAllowedByBuyer = buyerAllowedCats.length === 0 || buyerAllowedCats.includes(productCat);
  const isAllowedByAgent = agentAllowedCats.length === 0 || agentAllowedCats.includes(productCat);
  const categoryPermitted = isAllowedByBuyer && isAllowedByAgent && !isBlockedByAgent;

  rulesEvaluated.push({
    rule: 'CATEGORY_ALLOWED',
    passed: categoryPermitted,
    details: `Product category '${product.category}' ${categoryPermitted ? 'is permitted' : isBlockedByAgent ? 'is explicitly blocked by agent' : 'is outside permitted categories'}`,
  });

  if (isBlockedByAgent) {
    violatedRules.push('CATEGORY_RESTRICTED');
    return {
      decision: 'BLOCK',
      rule: 'CATEGORY_RESTRICTED',
      reason: `Category '${product.category}' is restricted by agent policy (blocked)`,
      rulesEvaluated,
      violatedRules,
      policyVersion,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  if (!isAllowedByAgent && agentAllowedCats.length > 0) {
    violatedRules.push('CATEGORY_RESTRICTED');
    return {
      decision: 'BLOCK',
      rule: 'CATEGORY_RESTRICTED',
      reason: `Category '${product.category}' is restricted by agent policy`,
      rulesEvaluated,
      violatedRules,
      policyVersion,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  if (!categoryPermitted) {
    violatedRules.push('CATEGORY_NOT_PERMITTED');
    return {
      decision: 'BLOCK',
      rule: 'CATEGORY_NOT_PERMITTED',
      reason: `Category '${product.category}' is not permitted by your purchasing policy. Permitted categories: ${(buyerPolicy.categories || []).join(', ')}`,
      rulesEvaluated,
      violatedRules,
      policyVersion,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 8. Merchant Verification Check
  if (agent.verified_merchants_only) {
    rulesEvaluated.push({
      rule: 'MERCHANT_VERIFICATION',
      passed: product.is_verified,
      details: product.is_verified ? 'Merchant is verified' : 'Merchant is unverified',
    });

    if (!product.is_verified) {
      violatedRules.push('UNVERIFIED_MERCHANT');
      return {
        decision: 'BLOCK',
        rule: 'UNVERIFIED_MERCHANT',
        reason: `Policy requires purchases only from verified merchants. '${product.merchant_name}' is unverified.`,
        rulesEvaluated,
        violatedRules,
        policyVersion,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // 8b. Merchant Connection & Checkout Capability Check
  const merchantValidation = await merchantConnectionService.validateMerchantForCheckout(userId, product.merchant_id);
  rulesEvaluated.push({
    rule: 'MERCHANT_CHECKOUT_CAPABILITY',
    passed: merchantValidation.allowed,
    details: merchantValidation.reason,
  });

  if (!merchantValidation.allowed) {
    violatedRules.push('MERCHANT_CHECKOUT_UNAVAILABLE');
    return {
      decision: 'BLOCK',
      rule: 'MERCHANT_CHECKOUT_UNAVAILABLE',
      reason: merchantValidation.reason,
      rulesEvaluated,
      violatedRules,
      policyVersion,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 9. Price Integrity / Price Manipulation Check
  const requestedItemTotal = parseFloat(amount);
  const finalDeliveryFee = parseFloat(deliveryFee || product.delivery_fee || 0);
  const effectiveProduct = quotePrice ? { ...product, price: parseFloat(quotePrice) } : product;
  const calculatedPricing = calculatePrice({
    product: effectiveProduct,
    quantity,
    deliveryMethod: (finalDeliveryFee >= 199 || deliveryDays === 1) ? 'EXPRESS' : 'STANDARD',
  });
  const expectedSubtotal = calculatedPricing.subtotal;
  const expectedTotal = calculatedPricing.totalAmount;
  const tolerancePct = parseFloat(agent.price_tolerance_pct || env.PRICE_SURGE_TOLERANCE_PERCENT || 2.0);

  // Price surge occurs only if requested amount exceeds expected total and subtotal by more than tolerance
  const isSurge = requestedItemTotal > (expectedTotal * (1 + tolerancePct / 100)) && requestedItemTotal > (expectedSubtotal * (1 + tolerancePct / 100));
  const priceDiffPct = isSurge
    ? Math.min(
        ((requestedItemTotal - expectedSubtotal) / expectedSubtotal) * 100,
        ((requestedItemTotal - expectedTotal) / expectedTotal) * 100
      )
    : 0;

  const isPriceValid = !isSurge;
  rulesEvaluated.push({
    rule: 'PRICE_TOLERANCE',
    passed: isPriceValid,
    details: `Price diff ${priceDiffPct.toFixed(2)}% (tolerance: ${tolerancePct}%, requested: ₹${requestedItemTotal}, expectedTotal: ₹${expectedTotal})`,
  });

  if (!isPriceValid) {
    violatedRules.push('PRICE_MANIPULATION_DETECTED');
    return {
      decision: 'BLOCK',
      rule: 'PRICE_MANIPULATION_DETECTED',
      reason: `Requested price ₹${requestedItemTotal} deviates by ${priceDiffPct.toFixed(1)}% from verified catalog price ₹${expectedTotal} (tolerance max ${tolerancePct}%)`,
      rulesEvaluated,
      violatedRules,
      policyVersion,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 10. Shipping Cost & Total Payable Calculation
  const totalPayable = requestedItemTotal + finalDeliveryFee;

  // 11. Delivery SLA Hard Constraint Check
  const deliveryRules = buyerPolicy.deliveryRules || {};
  if (deliveryRules.isHardConstraint && deliveryDays !== null && deliveryRules.maxDays) {
    const deliveryPassed = deliveryDays <= deliveryRules.maxDays;
    rulesEvaluated.push({
      rule: 'DELIVERY_SLA_HARD_CONSTRAINT',
      passed: deliveryPassed,
      details: `Delivery time ${deliveryDays} days (Mandatory limit: ${deliveryRules.maxDays} days)`,
    });

    if (!deliveryPassed) {
      violatedRules.push('DELIVERY_SLA_EXCEEDED');
      return {
        decision: 'BLOCK',
        rule: 'DELIVERY_SLA_EXCEEDED',
        reason: `Delivery time of ${deliveryDays} days exceeds your mandatory delivery limit of ${deliveryRules.maxDays} days.`,
        rulesEvaluated,
        violatedRules,
        policyVersion,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // 12. Single-Transaction Ceiling & Autonomous Spending Limit
  let maxTx = agent.max_transaction ? parseFloat(agent.max_transaction) : 100000;
  let autoLimit = agent.approval_threshold ? parseFloat(agent.approval_threshold) : 50000;

  if (userId && buyerPolicy) {
    if (buyerPolicy.autoPurchaseLimit !== undefined) {
      const buyerAuto = parseFloat(buyerPolicy.autoPurchaseLimit);
      autoLimit = agent.approval_threshold ? Math.min(buyerAuto, parseFloat(agent.approval_threshold)) : buyerAuto;
    }
    if (!agent.max_transaction && buyerPolicy.monthlyBudget) {
      maxTx = Math.max(maxTx, autoLimit * 2);
    }
  }

  const withinMaxTx = totalPayable <= maxTx;
  rulesEvaluated.push({
    rule: 'MAX_TRANSACTION_LIMIT',
    passed: withinMaxTx,
    details: `Total payable ₹${totalPayable} <= single-transaction ceiling ₹${maxTx}`,
  });

  if (!withinMaxTx) {
    violatedRules.push('MAX_TRANSACTION_EXCEEDED');
    return {
      decision: 'BLOCK',
      rule: 'MAX_TRANSACTION_EXCEEDED',
      reason: `Transaction amount ₹${totalPayable.toLocaleString('en-IN')} exceeds single-transaction ceiling of ₹${maxTx.toLocaleString('en-IN')}`,
      rulesEvaluated,
      violatedRules,
      policyVersion,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 13. Authoritative Monthly Spending Budget Check
  const monthlyBudget = buyerPolicy.monthlyBudget;
  const spentThisMonth = buyerPolicy.spentThisMonth;
  const remainingMonthlyBudget = Math.max(0, monthlyBudget - spentThisMonth);
  const withinMonthlyBudget = totalPayable <= remainingMonthlyBudget;

  rulesEvaluated.push({
    rule: 'MONTHLY_BUDGET_LIMIT',
    passed: withinMonthlyBudget,
    details: `Spent this month: ₹${spentThisMonth}, Remaining: ₹${remainingMonthlyBudget}, Requested: ₹${totalPayable}, Monthly Budget: ₹${monthlyBudget}`,
  });

  if (!withinMonthlyBudget) {
    const overage = totalPayable - remainingMonthlyBudget;
    violatedRules.push('MONTHLY_BUDGET_EXCEEDED');
    return {
      decision: 'BLOCK',
      rule: 'MONTHLY_BUDGET_EXCEEDED',
      reason: `Purchase of ₹${totalPayable.toLocaleString('en-IN')} exceeds your monthly spending budget of ₹${monthlyBudget.toLocaleString('en-IN')} by ₹${overage.toLocaleString('en-IN')} (Spent this month: ₹${spentThisMonth.toLocaleString('en-IN')}, Remaining: ₹${remainingMonthlyBudget.toLocaleString('en-IN')})`,
      rulesEvaluated,
      violatedRules,
      policyVersion,
      monthlyBudget,
      spentThisMonth,
      remainingBudget: remainingMonthlyBudget,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 13b. Authoritative Daily Spending Budget Check
  const dailyBudget = agent.daily_budget ? parseFloat(agent.daily_budget) : 100000;
  const { dailySpent } = await calculateDailySpend(userId, agentId);
  const remainingDailyBudget = Math.max(0, dailyBudget - dailySpent);
  const withinDailyBudget = totalPayable <= remainingDailyBudget;

  rulesEvaluated.push({
    rule: 'DAILY_BUDGET_LIMIT',
    passed: withinDailyBudget,
    details: `Spent today: ₹${dailySpent}, Remaining daily: ₹${remainingDailyBudget}, Requested: ₹${totalPayable}, Daily Budget: ₹${dailyBudget}`,
  });

  if (!withinDailyBudget) {
    const dailyOverage = totalPayable - remainingDailyBudget;
    violatedRules.push('DAILY_BUDGET_EXCEEDED');
    return {
      decision: 'BLOCK',
      rule: 'DAILY_BUDGET_EXCEEDED',
      reason: `Purchase of ₹${totalPayable.toLocaleString('en-IN')} exceeds daily spending budget of ₹${dailyBudget.toLocaleString('en-IN')} by ₹${dailyOverage.toLocaleString('en-IN')} (Spent today: ₹${dailySpent.toLocaleString('en-IN')}, Remaining: ₹${remainingDailyBudget.toLocaleString('en-IN')})`,
      rulesEvaluated,
      violatedRules,
      policyVersion,
      dailyBudget,
      dailySpent,
      remainingDailyBudget,
      monthlyBudget,
      spentThisMonth,
      remainingBudget: remainingMonthlyBudget,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 14. Structured Category-Specific Spending Limits
  const categoryRules = buyerPolicy.categoryRules || {};
  const catRule = categoryRules[product.category] || categoryRules[productCat];
  if (catRule?.maxAmount && totalPayable > catRule.maxAmount) {
    rulesEvaluated.push({
      rule: 'CATEGORY_SPEND_CAP',
      passed: false,
      details: `Amount ₹${totalPayable} exceeds category cap of ₹${catRule.maxAmount} for ${product.category}`,
    });

    violatedRules.push('CATEGORY_LIMIT_EXCEEDED');
    return {
      decision: 'BLOCK',
      rule: 'CATEGORY_LIMIT_EXCEEDED',
      reason: `Transaction amount ₹${totalPayable.toLocaleString('en-IN')} exceeds configured spending ceiling of ₹${catRule.maxAmount.toLocaleString('en-IN')} for category '${product.category}'`,
      rulesEvaluated,
      violatedRules,
      policyVersion,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 15. Duplicate Transaction In-Flight Guard (within 2 minutes per user/product)
  let isDuplicate = false;
  if (intentId) {
    const duplicateParams = [productId, requestedItemTotal];
    let duplicateSql = `
      SELECT id, created_at, status
      FROM purchase_intents
      WHERE product_id = $1
        AND amount = $2
        AND status NOT IN ('pending', 'evaluating', 'blocked', 'rejected', 'cancelled', 'completed')
        AND created_at >= NOW() - INTERVAL '2 minutes'
    `;
    if (userId) {
      duplicateParams.push(userId);
      duplicateSql += ` AND user_id = $${duplicateParams.length}`;
    }
    duplicateParams.push(intentId);
    duplicateSql += ` AND id != $${duplicateParams.length}`;
    duplicateSql += ' LIMIT 1';

    const duplicateRes = await query(duplicateSql, duplicateParams);
    isDuplicate = duplicateRes.rows.length > 0;
  }

  rulesEvaluated.push({
    rule: 'DUPLICATE_PREVENTION',
    passed: !isDuplicate,
    details: isDuplicate ? 'Identical intent created within 2 minutes' : 'No duplicate in-flight transaction found',
  });

  if (isDuplicate) {
    violatedRules.push('DUPLICATE_TRANSACTION');
    return {
      decision: 'BLOCK',
      rule: 'DUPLICATE_TRANSACTION',
      reason: 'Duplicate transaction detected. A purchase for this exact product was already initiated within the last 2 minutes.',
      rulesEvaluated,
      violatedRules,
      policyVersion,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 16. Procurement Mode Check (MODE 2: ALWAYS REQUIRE HUMAN REVIEW)
  if (buyerPolicy.purchaseBehavior === 'always_ask') {
    rulesEvaluated.push({
      rule: 'PROCUREMENT_BEHAVIOR_ALWAYS_ASK',
      passed: false,
      details: 'Buyer policy configured to always require human review before payment',
    });

    return {
      decision: 'APPROVAL_REQUIRED',
      rule: 'PROCUREMENT_BEHAVIOR_ALWAYS_ASK',
      reason: 'Procurement policy is configured to always require human review and authorization before executing any payment.',
      rulesEvaluated,
      violatedRules: [],
      policyVersion,
      amount: totalPayable,
      threshold: 0,
      monthlyBudget,
      spentThisMonth,
      remainingBudget: remainingMonthlyBudget,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 17. Structured Category-Specific Approval Requirement
  if (catRule?.requireApproval) {
    rulesEvaluated.push({
      rule: 'CATEGORY_APPROVAL_REQUIRED',
      passed: false,
      details: `Category '${product.category}' explicitly requires human authorization`,
    });

    return {
      decision: 'APPROVAL_REQUIRED',
      rule: 'CATEGORY_APPROVAL_REQUIRED',
      reason: `Purchases in category '${product.category}' require explicit human authorization by your procurement rules.`,
      rulesEvaluated,
      violatedRules: [],
      policyVersion,
      amount: totalPayable,
      threshold: buyerPolicy.autoPurchaseLimit,
      monthlyBudget,
      spentThisMonth,
      remainingBudget: remainingMonthlyBudget,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 17b. Buyer Payment Authorization & Mandate Limit Check
  if (userId) {
    const authResult = await paymentMethodService.verifyPaymentAuthorization(userId, totalPayable);
    rulesEvaluated.push({
      rule: 'PAYMENT_AUTHORIZATION',
      passed: authResult.authorized,
      details: authResult.reason,
    });

    if (!authResult.authorized) {
      violatedRules.push(authResult.rule);
      return {
        decision: 'BLOCK',
        rule: authResult.rule,
        reason: authResult.reason,
        rulesEvaluated,
        violatedRules,
        policyVersion,
        amount: totalPayable,
        threshold: authResult.threshold || 0,
        monthlyBudget,
        spentThisMonth,
        remainingBudget: remainingMonthlyBudget,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // 18. Autonomous Single-Purchase Limit Evaluation
  const requiresApproval = totalPayable > autoLimit;

  rulesEvaluated.push({
    rule: 'APPROVAL_THRESHOLD',
    passed: !requiresApproval,
    details: `Total payable ₹${totalPayable} ${requiresApproval ? '>' : '<='} autonomous threshold ₹${autoLimit}`,
  });

  if (requiresApproval) {
    const diff = totalPayable - autoLimit;
    return {
      decision: 'APPROVAL_REQUIRED',
      rule: 'APPROVAL_THRESHOLD',
      reason: `Transaction amount ₹${totalPayable.toLocaleString('en-IN')} exceeds autonomous spending threshold of ₹${autoLimit.toLocaleString('en-IN')}. Human authorization required.`,
      rulesEvaluated,
      violatedRules: [],
      policyVersion,
      amount: totalPayable,
      threshold: autoLimit,
      monthlyBudget,
      spentThisMonth,
      remainingBudget: remainingMonthlyBudget,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 19. All Deterministic Policy Checks Passed -> ALLOW
  return {
    decision: 'ALLOW',
    rule: 'ALL_POLICIES_PASSED',
    reason: `Transaction of ₹${totalPayable.toLocaleString('en-IN')} satisfies all spending limits, category allowances, and procurement rules.`,
    rulesEvaluated,
    violatedRules: [],
    policyVersion,
    amount: totalPayable,
    threshold: autoLimit,
    monthlyBudget,
    spentThisMonth,
    remainingBudget: remainingMonthlyBudget,
    latencyMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };
}

export default { evaluatePolicy };
