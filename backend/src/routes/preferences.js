import { Router } from 'express';
import { query } from '../config/database.js';
import { getUserIdFromRequest } from '../utils/authUtils.js';
import { getSpendingSummary, calculateMonthlySpend } from '../services/spendingService.js';
import { parseNaturalLanguagePreference } from '../services/preferenceParser.js';
import { evaluatePolicy } from '../services/policyEngine.js';
import { parseBuyerIntent } from '../services/intentParser.js';
import { findEligibleProducts } from '../services/candidateFilter.js';
import { requireAuth, requireBuyer } from '../middleware/authMiddleware.js';

const router = Router();

// GET /api/preferences — Get authoritative preferences and spend accounting for current user (Protected)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const spendingSummary = await getSpendingSummary(userId);

    res.json({
      preferences: {
        monthlyBudget: spendingSummary.monthlyBudget,
        spentThisMonth: spendingSummary.spentThisMonth,
        grossSpent: spendingSummary.grossSpent,
        totalRefunded: spendingSummary.totalRefunded,
        orderCount: spendingSummary.orderCount,
        remainingBudget: spendingSummary.remainingBudget,
        automaticPurchaseLimit: spendingSummary.autoPurchaseLimit,
        autoPurchaseLimit: spendingSummary.autoPurchaseLimit,
        categories: spendingSummary.categories,
        preferredBrands: spendingSummary.preferredBrands,
        deliveryPreference: spendingSummary.deliveryPreference,
        purchaseBehavior: spendingSummary.purchaseBehavior,
        customCriteria: spendingSummary.customCriteria,
        naturalLanguageRules: spendingSummary.naturalLanguageRules,
        categoryRules: spendingSummary.categoryRules,
        deliveryRules: spendingSummary.deliveryRules,
        brandRules: spendingSummary.brandRules,
        policyVersion: spendingSummary.policyVersion,
        naturalRules: [
          'Prefer verified merchants with rapid delivery.',
          'Transactions exceeding autonomous limit escalate to human review.',
        ],
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/preferences — Save preferences, validate boundaries, increment version, and record audit history
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const {
      monthlyBudget = 100000,
      automaticPurchaseLimit,
      autoPurchaseLimit,
      categories = ['Electronics', 'Peripherals'],
      preferredBrands = ['Apple', 'Sony', 'Logitech'],
      deliveryPreference = 'Fastest available (within 2 days)',
      purchaseBehavior = 'auto_within_limit',
      customCriteria = [],
      naturalLanguageRules = [],
      categoryRules = {},
      deliveryRules = {},
      brandRules = {},
    } = req.body;

    const effectiveAutoLimit = autoPurchaseLimit !== undefined ? autoPurchaseLimit : (automaticPurchaseLimit !== undefined ? automaticPurchaseLimit : 50000);
    const numMonthlyBudget = parseFloat(monthlyBudget);
    const numAutoLimit = parseFloat(effectiveAutoLimit);

    // Strict Server-Side Validation
    if (isNaN(numMonthlyBudget) || numMonthlyBudget <= 0) {
      return res.status(400).json({ error: 'Monthly budget must be a positive number greater than 0.' });
    }
    if (isNaN(numAutoLimit) || numAutoLimit < 0) {
      return res.status(400).json({ error: 'Autonomous purchase limit must be greater than or equal to 0.' });
    }
    if (numAutoLimit > numMonthlyBudget) {
      return res.status(400).json({ error: `Autonomous limit (₹${numAutoLimit}) cannot exceed total monthly budget (₹${numMonthlyBudget}).` });
    }
    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ error: 'At least one permitted product category must be selected.' });
    }
    if (!['auto_within_limit', 'always_ask'].includes(purchaseBehavior)) {
      return res.status(400).json({ error: 'Invalid procurement behavior specified.' });
    }

    // Fetch existing preferences for audit comparison
    const existingRes = await query('SELECT * FROM user_preferences WHERE user_id = $1', [userId]);
    const oldRow = existingRes.rows[0] || {};
    const oldVersion = parseInt(oldRow.policy_version || 1);
    const newVersion = oldVersion + 1;

    const changedFields = [];
    if (oldRow.monthly_budget !== numMonthlyBudget) changedFields.push('monthly_budget');
    if (oldRow.auto_purchase_limit !== numAutoLimit) changedFields.push('auto_purchase_limit');
    if (JSON.stringify(oldRow.categories) !== JSON.stringify(categories)) changedFields.push('categories');
    if (JSON.stringify(oldRow.preferred_brands) !== JSON.stringify(preferredBrands)) changedFields.push('preferred_brands');
    if (oldRow.delivery_preference !== deliveryPreference) changedFields.push('delivery_preference');
    if (oldRow.purchase_behavior !== purchaseBehavior) changedFields.push('purchase_behavior');

    // Update user_preferences table
    await query(`
      INSERT INTO user_preferences (
        user_id, monthly_budget, auto_purchase_limit, categories, preferred_brands, delivery_preference, 
        purchase_behavior, custom_criteria, natural_language_rules, category_rules, delivery_rules, brand_rules, policy_version, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        monthly_budget = $2,
        auto_purchase_limit = $3,
        categories = $4,
        preferred_brands = $5,
        delivery_preference = $6,
        purchase_behavior = $7,
        custom_criteria = $8,
        natural_language_rules = $9,
        category_rules = $10,
        delivery_rules = $11,
        brand_rules = $12,
        policy_version = $13,
        updated_at = NOW()
    `, [
      userId,
      numMonthlyBudget,
      numAutoLimit,
      categories,
      preferredBrands,
      deliveryPreference,
      purchaseBehavior,
      JSON.stringify(customCriteria),
      JSON.stringify(naturalLanguageRules),
      JSON.stringify(categoryRules),
      JSON.stringify(deliveryRules),
      JSON.stringify(brandRules),
      newVersion,
    ]);

    // Record change audit in policy_change_history
    if (changedFields.length > 0) {
      await query(`
        INSERT INTO policy_change_history (
          user_id, policy_version, changed_fields, old_values, new_values, changed_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW())
      `, [
        userId,
        newVersion,
        JSON.stringify(changedFields),
        JSON.stringify(oldRow),
        JSON.stringify({
          monthly_budget: numMonthlyBudget,
          auto_purchase_limit: numAutoLimit,
          categories,
          preferred_brands: preferredBrands,
          delivery_preference: deliveryPreference,
          purchase_behavior: purchaseBehavior,
        }),
      ]);
    }

    // Sync associated agent policy thresholds
    await query(`
      UPDATE policies
      SET approval_threshold = $1::numeric,
          max_transaction = GREATEST(max_transaction, $1::numeric * 2),
          daily_budget = GREATEST(daily_budget, $2::numeric)
      WHERE id IN (
        SELECT policy_id FROM agents WHERE owner_id = $3
      )
    `, [numAutoLimit, numMonthlyBudget, userId]);

    const updatedSummary = await getSpendingSummary(userId);

    res.json({
      success: true,
      message: 'Purchasing preferences and spending policies updated successfully',
      preferences: {
        monthlyBudget: updatedSummary.monthlyBudget,
        spentThisMonth: updatedSummary.spentThisMonth,
        remainingBudget: updatedSummary.remainingBudget,
        automaticPurchaseLimit: updatedSummary.autoPurchaseLimit,
        categories: updatedSummary.categories,
        preferredBrands: updatedSummary.preferredBrands,
        deliveryPreference: updatedSummary.deliveryPreference,
        purchaseBehavior: updatedSummary.purchaseBehavior,
        customCriteria: updatedSummary.customCriteria,
        naturalLanguageRules: updatedSummary.naturalLanguageRules,
        categoryRules: updatedSummary.categoryRules,
        deliveryRules: updatedSummary.deliveryRules,
        brandRules: updatedSummary.brandRules,
        policyVersion: updatedSummary.policyVersion,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/preferences/interpret — Natural language preference interpreter
router.post('/interpret', async (req, res, next) => {
  try {
    const { sentence } = req.body;
    if (!sentence || typeof sentence !== 'string') {
      return res.status(400).json({ error: 'Sentence is required' });
    }

    const result = parseNaturalLanguagePreference(sentence);

    res.json({
      original: sentence,
      extracted: result.structured,
      interpreted: result.structured,
      categoryRules: result.categoryRules,
      deliveryRules: result.deliveryRules,
      brandRules: result.brandRules,
      summary: result.summary,
      summaryItems: result.summaryItems,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/preferences/evaluate — Policy Preview & "Test My Rules" Simulation Endpoint
router.post('/evaluate', requireAuth, requireBuyer, async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const {
      queryText,
      amount,
      category,
      productId,
      deliveryFee = 0,
      deliveryDays = 2,
    } = req.body;

    const buyerPolicy = await getSpendingSummary(userId);

    let targetProductId = productId;
    let targetAmount = parseFloat(amount || 0);
    let targetCategory = category;
    let targetProductName = 'Hypothetical Purchase';

    // If queryText is provided, find matching product candidate
    if (queryText && !targetProductId) {
      const intent = parseBuyerIntent(queryText);
      const searchRes = await findEligibleProducts(intent, { userId, buyerPolicy });

      if (searchRes.status === 'NO_MATCH' || !searchRes.winningCandidate) {
        return res.json({
          decision: 'BLOCK',
          automatic_purchase: 'NO',
          action: 'Blocked by catalog / hard constraints',
          reason: searchRes.rejectionReasons[0] || 'No eligible product satisfies all constraints.',
          rules_evaluated: [
            { rule: 'CATALOG_ELIGIBILITY', passed: false, details: searchRes.explanation },
          ],
          spending_metrics: {
            monthlyBudget: buyerPolicy.monthlyBudget,
            spentThisMonth: buyerPolicy.spentThisMonth,
            remainingBudget: buyerPolicy.remainingBudget,
            autonomousLimit: buyerPolicy.autoPurchaseLimit,
          },
        });
      }

      const topCandidate = searchRes.winningCandidate;
      targetProductId = topCandidate.id;
      targetAmount = topCandidate.price;
      targetCategory = topCandidate.category;
      targetProductName = topCandidate.name;
    }

    if (!targetProductId) {
      // Direct price evaluation against spending policy boundaries
      const totalPayable = targetAmount + parseFloat(deliveryFee);
      const withinMonthlyBudget = totalPayable <= buyerPolicy.remainingBudget;
      const requiresApproval = buyerPolicy.purchaseBehavior === 'always_ask' || totalPayable > buyerPolicy.autoPurchaseLimit;

      let decision = 'ALLOW';
      let reason = `Hypothetical purchase of ₹${totalPayable.toLocaleString('en-IN')} is within all autonomous spending limits.`;

      if (!withinMonthlyBudget) {
        decision = 'BLOCK';
        reason = `Purchase of ₹${totalPayable.toLocaleString('en-IN')} would exceed remaining monthly budget of ₹${buyerPolicy.remainingBudget.toLocaleString('en-IN')} (Monthly budget: ₹${buyerPolicy.monthlyBudget.toLocaleString('en-IN')}, Spent: ₹${buyerPolicy.spentThisMonth.toLocaleString('en-IN')}).`;
      } else if (requiresApproval) {
        decision = 'APPROVAL_REQUIRED';
        reason = buyerPolicy.purchaseBehavior === 'always_ask'
          ? 'Procurement policy requires human approval for all transactions.'
          : `Amount ₹${totalPayable.toLocaleString('en-IN')} exceeds autonomous limit of ₹${buyerPolicy.autoPurchaseLimit.toLocaleString('en-IN')}. Human authorization required.`;
      }

      return res.json({
        decision,
        automatic_purchase: decision === 'ALLOW' ? 'YES' : 'NO',
        action: decision === 'ALLOW' ? 'Proceed with autonomous payment' : decision === 'APPROVAL_REQUIRED' ? 'Escalate to human review' : 'Block purchase',
        reason,
        total_amount: totalPayable,
        spending_metrics: {
          monthlyBudget: buyerPolicy.monthlyBudget,
          spentThisMonth: buyerPolicy.spentThisMonth,
          remainingBudget: buyerPolicy.remainingBudget,
          autonomousLimit: buyerPolicy.autoPurchaseLimit,
        },
      });
    }

    // Full deterministic policy evaluation using policyEngine
    const evaluation = await evaluatePolicy({
      userId,
      productId: targetProductId,
      amount: targetAmount,
      deliveryFee,
      deliveryDays,
    });

    res.json({
      decision: evaluation.decision,
      automatic_purchase: evaluation.decision === 'ALLOW' ? 'YES' : 'NO',
      action: evaluation.decision === 'ALLOW' ? 'Proceed with autonomous payment' : evaluation.decision === 'APPROVAL_REQUIRED' ? 'Escalate to human review' : 'Block purchase',
      product_name: targetProductName,
      amount: targetAmount,
      reason: evaluation.reason,
      rules_evaluated: evaluation.rulesEvaluated,
      violated_rules: evaluation.violatedRules,
      spending_metrics: {
        monthlyBudget: buyerPolicy.monthlyBudget,
        spentThisMonth: buyerPolicy.spentThisMonth,
        remainingBudget: buyerPolicy.remainingBudget,
        autonomousLimit: buyerPolicy.autoPurchaseLimit,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
