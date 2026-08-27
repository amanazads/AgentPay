import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../config/database.js';
import env from '../config/env.js';
import { evaluatePurchaseIntent } from '../services/decisionEngine.js';
import { recordAuditEvent } from '../services/auditService.js';
import { generateIdempotencyKey } from '../utils/helpers.js';
import { commerceOrchestrator } from '../services/merchantAdapter.js';
import { getUserIdFromRequest } from '../utils/authUtils.js';
import { evaluatePolicy } from '../services/policyEngine.js';
import { assessRisk } from '../services/riskEngine.js';
import { createPaymentOrder, verifyPayment } from '../services/paymentService.js';
import { createOrder } from '../services/orderService.js';
import { generateInvoiceForOrder } from '../services/invoiceService.js';
import { getDefaultAddress } from '../services/addressService.js';
import { dispatchCommerceNotification } from '../services/notificationDispatcher.js';

import { parseBuyerIntent } from '../services/intentParser.js';
import { findEligibleProducts } from '../services/candidateFilter.js';
import { validatePurchaseCandidate, PurchaseValidationError } from '../services/purchaseGate.js';
import { acquireIdempotencyLock, releaseIdempotencyLock } from '../services/idempotencyService.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/ai/catalog
 * Track 01 Requirement #1: Normalized AI-Readable Merchant Catalog Feed
 * Schema: agentpay.catalog.v1
 */
router.get('/catalog', async (req, res, next) => {
  try {
    const { category, minPrice, maxPrice, search, merchantId, inStockOnly = 'true', limit = 50, offset = 0 } = req.query;

    const conditions = ["(p.is_test_lab = false OR p.is_test_lab IS NULL) AND (p.status = 'ACTIVE' OR p.status IS NULL)"];
    const params = [];

    if (inStockOnly === 'true') {
      conditions.push('p.in_stock = true');
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length} OR p.brand ILIKE $${params.length} OR p.category ILIKE $${params.length})`);
    }

    if (category) {
      params.push(category);
      conditions.push(`p.category ILIKE $${params.length}`);
    }

    if (minPrice) {
      params.push(parseFloat(minPrice));
      conditions.push(`p.price >= $${params.length}`);
    }

    if (maxPrice) {
      params.push(parseFloat(maxPrice));
      conditions.push(`p.price <= $${params.length}`);
    }

    if (merchantId) {
      params.push(merchantId);
      conditions.push(`p.merchant_id = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT p.*,
             m.name as merchant_name,
             m.is_verified as merchant_verified,
             m.rating as merchant_rating,
             m.risk_level as merchant_risk_level,
             m.tier as merchant_tier,
             pam.ai_summary,
             pam.target_audience,
             pam.use_cases,
             pam.keywords as ai_keywords,
             pam.specifications_normalized,
             pam.is_promoted
      FROM products p
      JOIN merchants m ON p.merchant_id = m.id
      LEFT JOIN product_ai_metadata pam ON pam.product_id = p.id
      ${whereClause}
      ORDER BY pam.is_promoted DESC NULLS LAST, p.price ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    params.push(parseInt(limit), parseInt(offset));
    const result = await query(sql, params);

    // Formatted normalized machine-readable items (Private merchant margins strictly stripped)
    const normalizedItems = result.rows.map((row) => ({
      productId: row.id,
      sku: row.sku || `SKU-${row.id.substring(0, 8).toUpperCase()}`,
      title: row.name,
      description: row.description,
      category: row.category,
      brand: row.brand || 'Verified Hardware',
      pricing: {
        amount: parseFloat(row.price),
        currency: row.currency || 'INR',
        formatted: `₹${parseFloat(row.price).toLocaleString('en-IN')}`,
        priceLockGuaranteed: true,
        priceLockDurationMinutes: 15,
      },
      inventory: {
        quantity: row.inventory ?? 25,
        inStock: row.in_stock,
        status: row.in_stock ? 'IN_STOCK' : 'OUT_OF_STOCK',
        minOrderQuantity: 1,
        maxOrderQuantity: Math.min(row.inventory ?? 10, 5),
      },
      specificationsNormalized: row.specifications_normalized || row.specifications || {},
      aiMetadata: {
        summary: row.ai_summary || `${row.name} with verified structured specifications.`,
        targetAudience: row.target_audience || 'Professionals, developers, and enterprise consumers',
        useCases: row.use_cases || ['Daily productivity', 'Enterprise use'],
        keywords: row.ai_keywords || [row.category?.toLowerCase(), row.brand?.toLowerCase()],
        isPromoted: Boolean(row.is_promoted),
      },
      delivery: {
        standard: {
          name: 'Standard Surface Delivery',
          fee: 0,
          currency: 'INR',
          estimatedDays: 2,
          carrier: 'AgentPay Express Logistics',
        },
        express: {
          name: 'Next-Day Express Air',
          fee: 199,
          currency: 'INR',
          estimatedDays: 1,
          carrier: 'AgentPay Priority Air',
        },
      },
      merchant: {
        id: row.merchant_id,
        name: row.merchant_name,
        isVerified: row.merchant_verified,
        rating: parseFloat(row.merchant_rating) || 4.9,
        riskLevel: row.merchant_risk_level || 'low',
        trustScore: row.merchant_verified ? 98 : 60,
      },
      protocol: {
        quoteUrl: `/api/ai/quote`,
        cartUrl: `/api/ai/cart`,
        checkoutUrl: `/api/ai/checkout`,
      },
    }));

    res.json({
      protocol: 'agentic-commerce/v1',
      schema: 'agentpay.catalog.v1',
      totalCount: normalizedItems.length,
      limit: parseInt(limit),
      offset: parseInt(offset),
      timestamp: new Date().toISOString(),
      items: normalizedItems,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ai/catalog/:productId
 * Track 01 Requirement #1: Normalized single-product machine specification
 */
router.get('/catalog/:productId', async (req, res, next) => {
  try {
    const { productId } = req.params;
    const result = await query(`
      SELECT p.*,
             m.name as merchant_name,
             m.is_verified as merchant_verified,
             m.rating as merchant_rating,
             m.risk_level as merchant_risk_level,
             pam.ai_summary,
             pam.target_audience,
             pam.use_cases,
             pam.keywords as ai_keywords,
             pam.specifications_normalized,
             pam.margin_tier
      FROM products p
      JOIN merchants m ON p.merchant_id = m.id
      LEFT JOIN product_ai_metadata pam ON pam.product_id = p.id
      WHERE p.id = $1
    `, [productId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const row = result.rows[0];
    res.json({
      protocol: 'agentic-commerce/v1',
      schema: 'agentpay.product.v1',
      productId: row.id,
      sku: row.sku || `SKU-${row.id.substring(0, 8).toUpperCase()}`,
      title: row.name,
      description: row.description,
      category: row.category,
      brand: row.brand,
      pricing: {
        amount: parseFloat(row.price),
        currency: row.currency || 'INR',
        formatted: `₹${parseFloat(row.price).toLocaleString('en-IN')}`,
        priceLockGuaranteed: true,
      },
      inventory: {
        quantity: row.inventory ?? 25,
        inStock: row.in_stock,
        status: row.in_stock ? 'IN_STOCK' : 'OUT_OF_STOCK',
      },
      specificationsNormalized: row.specifications_normalized || row.specifications || {},
      aiMetadata: {
        summary: row.ai_summary,
        targetAudience: row.target_audience,
        useCases: row.use_cases,
        keywords: row.ai_keywords,
      },
      merchant: {
        id: row.merchant_id,
        name: row.merchant_name,
        isVerified: row.merchant_verified,
        rating: parseFloat(row.merchant_rating) || 4.9,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai/quote
 * Track 01 Requirement #3: Machine-Guaranteed Price Quote with 15-Minute Price Lock
 */
router.post('/quote', async (req, res, next) => {
  try {
    const { productId, quantity = 1, deliveryMethod = 'STANDARD' } = req.body || {};
    if (!productId) return res.status(400).json({ error: 'productId is required' });

    const pRes = await query(`
      SELECT p.*, m.name as merchant_name, m.is_verified as merchant_verified
      FROM products p
      JOIN merchants m ON p.merchant_id = m.id
      WHERE p.id = $1 AND p.in_stock = true
    `, [productId]);

    if (pRes.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found or out of stock' });
    }

    const product = pRes.rows[0];
    const unitPrice = parseFloat(product.price);
    const subtotal = unitPrice * parseInt(quantity);
    const deliveryFee = deliveryMethod === 'EXPRESS' ? 199 : 0;
    const taxAmount = Math.round(subtotal * 0.18);
    const totalAmount = subtotal + deliveryFee;

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const quotePayload = `${product.id}|${quantity}|${totalAmount}|${expiresAt}`;
    const quoteSignature = crypto.createHmac('sha256', env.JWT_SECRET || 'agentpay_quote_secret').update(quotePayload).digest('hex');

    res.json({
      protocol: 'agentic-commerce/v1',
      quoteId: `quote_${crypto.randomBytes(8).toString('hex')}`,
      productId: product.id,
      productName: product.name,
      merchantId: product.merchant_id,
      merchantName: product.merchant_name,
      quantity: parseInt(quantity),
      unitPrice,
      subtotal,
      deliveryMethod,
      deliveryFee,
      taxAmount,
      totalAmount,
      currency: 'INR',
      quoteExpiresAt: expiresAt,
      priceLockSignature: quoteSignature,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai/chat — Conversational AI Buyer Agent Procurement
 */
router.post('/chat', async (req, res, next) => {
  try {
    const { message, agent_id, user_id } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const authUserId = getUserIdFromRequest(req);
    let finalUserId = authUserId;
    if (!finalUserId) {
      if (user_id) {
        const uCheck = await query('SELECT id FROM users WHERE id::text = $1', [user_id]);
        if (uCheck.rows.length > 0) finalUserId = uCheck.rows[0].id;
      }
    }
    if (!finalUserId) {
      const defaultUserRes = await query("SELECT id FROM users WHERE role = 'BUYER' OR role = 'user' LIMIT 1");
      finalUserId = defaultUserRes.rows[0]?.id;
    }

    const io = req.app.get('io');

    // 1. Try FastAPI AI Service first
    try {
      const response = await fetch(`${env.AI_SERVICE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, agent_id, user_id: finalUserId }),
      });

      if (response.ok) {
        const data = await response.json();
        return res.json(data);
      }
    } catch (pyErr) {
      // FastAPI service offline, proceed to high-performance native orchestrator
    }

    // 2. High-Performance Deterministic Multi-Merchant Orchestrator
    let targetAgentId = agent_id;
    let agentName = 'Procurement Agent';
    if (targetAgentId) {
      const aRes = await query('SELECT name FROM agents WHERE id = $1', [targetAgentId]);
      if (aRes.rows.length > 0) agentName = aRes.rows[0].name;
    } else {
      const aRes = await query("SELECT id, name FROM agents WHERE name ILIKE '%Procurement%' LIMIT 1");
      if (aRes.rows.length > 0) {
        targetAgentId = aRes.rows[0].id;
        agentName = aRes.rows[0].name;
      }
    }

    // 3. Parse Intent & Extract Hard Constraints
    const parsedIntent = parseBuyerIntent(message);
    const maxBudget = parsedIntent.maxPrice;

    // 4. Find Eligible Candidates (Strict Hard Filtering, NO Fallback)
    const matchResult = await findEligibleProducts(parsedIntent, { userId: finalUserId, limit: 10 });

    if (matchResult.status === 'NO_MATCH' || !matchResult.winningCandidate) {
      return res.json({
        status: 'NO_MATCH',
        agent_name: agentName,
        reply: `I couldn't find an in-stock product that matches all of your explicit requirements.\n\n${matchResult.explanation}\n\nWould you like me to search other connected merchants or relax your budget?`,
        intent_parsed: parsedIntent,
        rejection_reasons: matchResult.rejectionReasons || [],
        recommendation: null,
        authorization_status: {
          state: 'NO_MATCH',
          explanation: 'No product in authoritative merchant catalogs satisfies 100% of hard constraints.',
          policy_summary: 'No financial transaction authorized.',
        },
        tools_called: ['search_authoritative_catalog', 'evaluate_hard_constraints'],
      });
    }

    const product = matchResult.winningCandidate;

    // 5. Purchase Gate: Independent Pre-Transaction Candidate Validation
    const validationResult = await validatePurchaseCandidate(product, parsedIntent);
    if (!validationResult.valid) {
      return res.status(400).json({
        status: 'VALIDATION_FAILED',
        error: 'Product candidate failed pre-purchase validation.',
      });
    }

    // 6. Build Comparison Set from Valid Candidates
    const comparison = matchResult.candidates.slice(0, 3).map((p) => ({
      merchantName: p.merchant_name,
      productName: p.name,
      price: parseFloat(p.price),
      deliveryDays: p.delivery_days || 2,
      rating: p.merchant_rating || 4.8,
      inStock: p.in_stock,
      matchedRules: p.matchedRules || [],
    }));

    const price = parseFloat(product.price);
    const clientKey = req.headers['idempotency-key'] || req.body?.idempotency_key;
    const idempotencyKey = clientKey || crypto.createHash('sha256').update(`${finalUserId}_${product.id}_${price}_${parsedIntent.rawQuery || message}`).digest('hex');

    // 7. Create Merchant Cart & Checkout through Adapter
    const merchantAdapter = await commerceOrchestrator.getAdapter(product.merchant_id);
    let merchantCheckout = null;
    if (merchantAdapter) {
      const cart = await merchantAdapter.createCart([{ productId: product.id, quantity: parsedIntent.quantity || 1 }]);
      merchantCheckout = await merchantAdapter.createCheckout(cart);
    }

    // 8. Distributed Idempotency Concurrency Guard
    const lockAcquired = await acquireIdempotencyLock(idempotencyKey, 30);
    if (!lockAcquired) {
      logger.info('Chat', `Concurrent in-flight request detected for key ${idempotencyKey} — awaiting primary completion.`);
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const existingOrderRes = await query(`
          SELECT o.* FROM orders o
          JOIN purchase_intents pi ON o.purchase_intent_id = pi.id
          WHERE pi.idempotency_key = $1
        `, [idempotencyKey]);

        if (existingOrderRes.rows.length > 0) {
          const confirmedOrder = existingOrderRes.rows[0];
          const invRes = await query('SELECT * FROM invoices WHERE order_id = $1', [confirmedOrder.id]);
          const intentRes = await query('SELECT * FROM purchase_intents WHERE idempotency_key = $1', [idempotencyKey]);

          return res.json({
            status: 'MATCH_FOUND',
            execution_status: 'COMPLETED',
            is_duplicate: true,
            agent_name: agentName,
            reply: `I found the best match: **${product.name}** from *${product.merchant_name}* for **₹${price.toLocaleString('en-IN')}**.\n\nAll requirements and spending policies verified. Autonomous purchase confirmed (Order: ${confirmedOrder.order_number}).`,
            intent_parsed: parsedIntent,
            recommendation: {
              product_id: product.id,
              name: product.name,
              brand: product.brand,
              price,
              merchant_name: product.merchant_name,
              merchant_id: product.merchant_id,
              matched_rules: product.matchedRules || [],
              reason: product.selectionReason || `Matches all user criteria at ₹${price.toLocaleString('en-IN')}.`,
              specifications: product.specifications || {},
            },
            comparison,
            merchant_checkout: merchantCheckout,
            order: confirmedOrder,
            invoice: invRes.rows[0] || null,
            purchase_intent: intentRes.rows[0] || null,
          });
        }
      }

      // If loop exited, check if intent was created by primary request
      const fallbackIntentRes = await query('SELECT * FROM purchase_intents WHERE idempotency_key = $1', [idempotencyKey]);
      if (fallbackIntentRes.rows.length > 0) {
        const pi = fallbackIntentRes.rows[0];
        return res.json({
          status: 'MATCH_FOUND',
          execution_status: pi.status === 'blocked' ? 'BLOCKED' : pi.status === 'approval_required' ? 'APPROVAL_REQUIRED' : 'IN_PROGRESS',
          is_duplicate: true,
          agent_name: agentName,
          reply: `Processing transaction for **${product.name}** (Intent ID: ${pi.id}).`,
          intent_parsed: parsedIntent,
          recommendation: {
            product_id: product.id,
            name: product.name,
            brand: product.brand,
            price,
            merchant_name: product.merchant_name,
            merchant_id: product.merchant_id,
            matched_rules: product.matchedRules || [],
            reason: product.selectionReason || `Matches all user criteria at ₹${price.toLocaleString('en-IN')}.`,
            specifications: product.specifications || {},
          },
          comparison,
          purchase_intent: pi,
        });
      }
    }

    let purchaseIntent;
    let confirmedOrder = null;
    let invoice = null;

    try {
      const existingIntentRes = await query('SELECT * FROM purchase_intents WHERE idempotency_key = $1', [idempotencyKey]);
      if (existingIntentRes.rows.length > 0) {
        purchaseIntent = existingIntentRes.rows[0];
        logger.info('Intent', `Existing purchase intent ${purchaseIntent.id} found for idempotency key ${idempotencyKey}.`);

        // Check if existing order is already confirmed
        const existingOrderRes = await query('SELECT * FROM orders WHERE purchase_intent_id = $1', [purchaseIntent.id]);
        if (existingOrderRes.rows.length > 0) {
          confirmedOrder = existingOrderRes.rows[0];
          const invRes = await query('SELECT * FROM invoices WHERE order_id = $1', [confirmedOrder.id]);
          invoice = invRes.rows[0] || null;

          return res.json({
            status: 'MATCH_FOUND',
            execution_status: 'COMPLETED',
            is_duplicate: true,
            agent_name: agentName,
            reply: `Your purchase is already confirmed: **${product.name}** (Order: ${confirmedOrder.order_number}).`,
            intent_parsed: parsedIntent,
            recommendation: {
              product_id: product.id,
              name: product.name,
              brand: product.brand,
              price,
              merchant_name: product.merchant_name,
              merchant_id: product.merchant_id,
              matched_rules: product.matchedRules || [],
              reason: product.selectionReason || `Matches all user criteria at ₹${price.toLocaleString('en-IN')}.`,
              specifications: product.specifications || {},
            },
            comparison,
            merchant_checkout: merchantCheckout,
            order: confirmedOrder,
            invoice,
            purchase_intent: purchaseIntent,
          });
        }
      } else {
      try {
        const intentRes = await query(`
          INSERT INTO purchase_intents (
            agent_id, user_id, product_id, merchant_id, amount,
            quantity, ai_reasoning, ai_recommendation, idempotency_key, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
          RETURNING *
        `, [
          targetAgentId,
          finalUserId,
          product.id,
          product.merchant_id,
          price,
          parsedIntent.quantity || 1,
          `AI Agent selected '${product.name}' from ${product.merchant_name} for ₹${price.toLocaleString('en-IN')} matching all user criteria (${product.matchedRules?.join(', ') || 'verified specs'}).`,
          `Optimal verified match across connected merchants at ₹${price.toLocaleString('en-IN')}.`,
          idempotencyKey,
        ]);
        purchaseIntent = intentRes.rows[0];
      } catch (insertErr) {
        if (insertErr.code === '23505') {
          const raceIntentRes = await query('SELECT * FROM purchase_intents WHERE idempotency_key = $1', [idempotencyKey]);
          purchaseIntent = raceIntentRes.rows[0];
        } else {
          throw insertErr;
        }
      }
    }

    // 9. Evaluate Deterministic Server-Side Policy
    const evaluation = await evaluatePurchaseIntent(purchaseIntent.id, io);

    // 10. Audit Log
    await recordAuditEvent({
      eventType: 'PURCHASE_INTENT_EVALUATION',
      actor: 'agent',
      agentId: targetAgentId,
      userId: finalUserId,
      purchaseIntentId: purchaseIntent.id,
      action: 'EVALUATE_PURCHASE_INTENT',
      decision: evaluation.decision,
      reasoning: evaluation.reason,
      outcome: evaluation.decision === 'ALLOW' ? 'Autonomous purchase authorized' : evaluation.decision === 'APPROVAL_REQUIRED' ? 'Requires human review' : 'Blocked by policy',
      io,
    });

    const isAllowed = evaluation.decision === 'ALLOW';
    const isApproval = evaluation.decision === 'APPROVAL_REQUIRED';

    if (isAllowed) {
      let txId;
      const existingTxRes = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1', [purchaseIntent.id]);
      if (existingTxRes.rows.length > 0) {
        txId = existingTxRes.rows[0].id;
      } else {
        const rzpOrderId = `order_test_${Math.random().toString(36).substring(2, 10)}`;
        const idempotencyKeyTx = crypto.createHash('sha256').update(`chat_tx_${purchaseIntent.id}`).digest('hex');

        try {
          const txRes = await query(`
            INSERT INTO transactions (
              purchase_intent_id, agent_id, user_id, amount, currency, status, razorpay_order_id, idempotency_key
            )
            VALUES ($1, $2, $3, $4, 'INR', 'completed', $5, $6)
            RETURNING *
          `, [purchaseIntent.id, targetAgentId, finalUserId, price, rzpOrderId, idempotencyKeyTx]);
          txId = txRes.rows[0].id;
        } catch (txErr) {
          if (txErr.code === '23505') {
            const raceTxRes = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1', [purchaseIntent.id]);
            txId = raceTxRes.rows[0]?.id;
          } else {
            throw txErr;
          }
        }
      }

      const fakePaymentId = `pay_test_${Math.random().toString(36).substring(2, 10)}`;
      const deliveryAddress = await getDefaultAddress(finalUserId);

      confirmedOrder = await createOrder({
        purchaseIntentId: purchaseIntent.id,
        transactionId: txId,
        userId: finalUserId,
        merchantId: product.merchant_id,
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        productBrand: product.brand,
        productCategory: product.category,
        quantity: parsedIntent.quantity || 1,
        unitPrice: price,
        subtotal: price,
        discount: 0,
        tax: Math.round(price * 0.18),
        deliveryFee: 0,
        totalAmount: price,
        paymentMethod: 'PREPAID',
        paymentStatus: 'VERIFIED',
        deliveryAddress,
        carrier: 'AgentPay Test Logistics (Simulated Courier)',
        io,
      });

      try {
        invoice = await generateInvoiceForOrder(confirmedOrder.id, {
          paymentReference: fakePaymentId,
          io,
        });
      } catch (invErr) {
        const invRes = await query('SELECT * FROM invoices WHERE order_id = $1', [confirmedOrder.id]);
        invoice = invRes.rows[0] || null;
      }
    }

      const reply = isAllowed
        ? `I found the best match: **${product.name}** from *${product.merchant_name}* for **₹${price.toLocaleString('en-IN')}**.\n\nAll requirements and spending policies verified. Autonomous purchase confirmed (Order: ${confirmedOrder?.order_number || 'AGP-ORD-CONFIRMED'}).`
        : isApproval
        ? `I found **${product.name}** from *${product.merchant_name}* for **₹${price.toLocaleString('en-IN')}**.\n\nThis purchase exceeds your automatic limit and requires your 1-click approval.`
        : `I found **${product.name}** (₹${price.toLocaleString('en-IN')}), but the purchase was blocked: ${evaluation.reason}`;

      res.json({
        status: 'MATCH_FOUND',
        execution_status: isAllowed ? 'COMPLETED' : isApproval ? 'APPROVAL_REQUIRED' : 'BLOCKED',
        agent_name: agentName,
        reply,
        intent_parsed: parsedIntent,
        recommendation: {
          product_id: product.id,
          name: product.name,
          brand: product.brand,
          price,
          merchant_name: product.merchant_name,
          merchant_id: product.merchant_id,
          matched_rules: product.matchedRules || [],
          reason: product.selectionReason || `Matches all user criteria at ₹${price.toLocaleString('en-IN')}.`,
          specifications: product.specifications || {},
        },
        comparison,
        merchant_checkout: merchantCheckout,
        order: confirmedOrder,
        invoice,
        proposed_action: {
          type: 'CREATE_PURCHASE_INTENT',
          product_id: product.id,
          product_name: product.name,
          amount: price,
          merchant_id: product.merchant_id,
          merchant_name: product.merchant_name,
        },
        authorization_status: {
          state: evaluation.decision,
          explanation: evaluation.reason,
          policy_summary: 'Deterministic spending policies evaluated server-side. LLM has zero direct payment authority.',
        },
        tools_called: ['parse_intent', 'filter_eligible_candidates', 'validate_purchase_gate', 'create_purchase_intent'],
        purchase_intent: purchaseIntent,
        evaluation,
      });
    } finally {
      await releaseIdempotencyLock(idempotencyKey);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
