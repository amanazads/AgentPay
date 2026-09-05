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
import { dispatchCommerceNotification } from '../services/notificationDispatcher.js';
import { requireAuth, requireBuyer } from '../middleware/authMiddleware.js';

import { parseBuyerIntent, applyStructuredFilters, mergeAiIntent } from '../services/intentParser.js';
import { findEligibleProducts } from '../services/candidateFilter.js';
import { validatePurchaseCandidate, PurchaseValidationError } from '../services/purchaseGate.js';
import { acquireIdempotencyLock, releaseIdempotencyLock } from '../services/idempotencyService.js';
import { calculatePrice } from '../services/pricingService.js';
import { generateQuote, verifyQuoteForCheckout, QuoteVerificationError, QuoteErrorCodes } from '../services/quoteService.js';
import { reserveInventory } from '../services/inventoryService.js';
import { logger } from '../utils/logger.js';
import {
  AI_CATALOG_PREDICATE,
  AI_CATALOG_SELECT,
  normalizeCatalogProduct,
} from '../services/catalogEligibility.js';
import {
  detectInjectionThreat,
  scanMerchantContent,
  buildBlockedResponse,
} from '../services/promptSecurityGuard.js';

const router = Router();

/**
 * Resolves and authorizes an agent for the authenticated caller.
 *
 * Security invariant: the caller may never assert an arbitrary agentId. Any
 * agent referenced in a request body must be owned by the authenticated user
 * (or the caller must be an ADMIN). Returns { agentId, agentName }.
 */
async function resolveAuthorizedAgent(req, requestedAgentId) {
  const userId = getUserIdFromRequest(req);
  const uRes = await query('SELECT role FROM users WHERE id::text = $1', [userId]);
  const role = (uRes.rows[0]?.role || '').toUpperCase();

  if (requestedAgentId) {
    const aRes = await query('SELECT id, name, owner_id FROM agents WHERE id = $1', [requestedAgentId]);
    if (aRes.rows.length === 0) {
      const err = new Error('Agent not found');
      err.status = 404;
      throw err;
    }
    const agentRecord = aRes.rows[0];
    if (role !== 'ADMIN' && agentRecord.owner_id && agentRecord.owner_id !== userId) {
      const err = new Error('Unauthorized: You do not own the specified agent');
      err.status = 403;
      throw err;
    }
    return { agentId: agentRecord.id, agentName: agentRecord.name };
  }

  const aRes = await query(
    'SELECT id, name FROM agents WHERE owner_id::text = $1 ORDER BY created_at ASC LIMIT 1',
    [userId]
  );
  if (aRes.rows.length > 0) {
    return { agentId: aRes.rows[0].id, agentName: aRes.rows[0].name };
  }
  return { agentId: null, agentName: 'Procurement Agent' };
}

/**
 * GET /api/ai/catalog
 * Track 01 Requirement #1: Normalized AI-Readable Merchant Catalog Feed
 * Schema: agentpay.catalog.v1
 *
 * Eligibility is decided by the single canonical predicate in
 * services/catalogEligibility.js. Nothing outside that module gets to define
 * what an AI buyer may see.
 */
router.get('/catalog', async (req, res, next) => {
  try {
    const {
      category, minPrice, maxPrice, search, merchantId,
      productType, brand,
      limit = 50, offset = 0,
    } = req.query;

    const conditions = [AI_CATALOG_PREDICATE];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(
        p.name ILIKE $${params.length}
        OR p.description ILIKE $${params.length}
        OR p.brand ILIKE $${params.length}
        OR p.category ILIKE $${params.length}
        OR p.product_type ILIKE $${params.length}
        OR p.sku ILIKE $${params.length}
      )`);
    }

    if (category) {
      params.push(category);
      conditions.push(`p.category ILIKE $${params.length}`);
    }

    if (productType) {
      params.push(productType);
      conditions.push(`p.product_type ILIKE $${params.length}`);
    }

    if (brand) {
      params.push(brand);
      conditions.push(`p.brand ILIKE $${params.length}`);
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

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Bounded page size, and a real total so an AI buyer can page rather than
    // silently accepting a truncated first page as "the catalog".
    const pageLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const pageOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const countRes = await query(
      `SELECT COUNT(*)::int AS total FROM products p JOIN merchants m ON p.merchant_id = m.id ${whereClause}`,
      params
    );
    const totalCount = countRes.rows[0]?.total ?? 0;

    const sql = `
      ${AI_CATALOG_SELECT}
      ${whereClause}
      ORDER BY pam.is_promoted DESC NULLS LAST, p.price ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const result = await query(sql, [...params, pageLimit, pageOffset]);
    const items = result.rows.map(normalizeCatalogProduct);

    res.json({
      protocol: 'agentic-commerce/v1',
      schema: 'agentpay.catalog.v1',
      totalCount,
      returnedCount: items.length,
      limit: pageLimit,
      offset: pageOffset,
      hasMore: pageOffset + items.length < totalCount,
      timestamp: new Date().toISOString(),
      items,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ai/catalog/:productId
 * Track 01 Requirement #1: Normalized single-product machine specification
 *
 * Applies EXACTLY the same eligibility boundary as the list endpoint. This
 * previously had no eligibility filter at all, so a caller who knew (or
 * guessed) an id could read test-lab, inactive and commerce-ineligible
 * products straight out of the AI catalog.
 *
 * An ineligible product is reported as 404, not 403: the AI catalog does not
 * confirm the existence of products outside its boundary.
 */
router.get('/catalog/:productId', async (req, res, next) => {
  try {
    const { productId } = req.params;

    const result = await query(
      `${AI_CATALOG_SELECT} WHERE p.id = $1 AND ${AI_CATALOG_PREDICATE}`,
      [productId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Product not found in the AI commerce catalog',
        code: 'PRODUCT_NOT_ELIGIBLE_OR_NOT_FOUND',
      });
    }

    res.json({
      ...normalizeCatalogProduct(result.rows[0]),
      schema: 'agentpay.product.v1',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai/quote
 * Track 01 Requirement #3: Machine-Guaranteed Price Quote with 15-Minute Price Lock
 */
router.post('/quote', requireAuth, requireBuyer, async (req, res, next) => {
  try {
    const {
      productId,
      quantity = 1,
      deliveryMethod = req.body?.deliveryType || 'STANDARD',
      deliveryType,
      durationMinutes = 15,
    } = req.body || {};

    // SECURITY: userId and agentId are derived from the verified session only.
    // A quote is a signed price lock that also holds inventory, so the caller
    // must never be able to mint one bound to another buyer's identity.
    const userId = getUserIdFromRequest(req);
    const { agentId } = await resolveAuthorizedAgent(req, req.body?.agentId);

    const effectiveDeliveryMethod = deliveryMethod || deliveryType || 'STANDARD';

    if (!productId) {
      return res.status(400).json({ error: 'productId is required', code: QuoteErrorCodes.INVALID_INPUT });
    }

    const requestedQty = parseInt(quantity, 10) || 1;
    if (requestedQty < 1 || requestedQty > 100) {
      return res.status(400).json({
        error: 'quantity must be between 1 and 100',
        code: QuoteErrorCodes.INVALID_INPUT,
      });
    }

    // Quote lifetime is server-governed; a client cannot extend its own price lock.
    const requestedDuration = parseInt(durationMinutes, 10) || 15;
    const boundedDuration = Math.min(Math.max(requestedDuration, 1), 15);

    const quote = await generateQuote({
      productId,
      quantity: requestedQty,
      deliveryMethod: effectiveDeliveryMethod,
      userId,
      agentId,
      durationMinutes: boundedDuration,
    });

    res.json(quote);
  } catch (err) {
    if (err instanceof QuoteVerificationError) {
      return res.status(err.code === QuoteErrorCodes.PRODUCT_NOT_FOUND ? 404 : 400).json({
        error: err.message,
        code: err.code,
        details: err.details,
      });
    }
    next(err);
  }
});

/**
 * POST /api/ai/checkout
 * Track 01 Requirement #4: Cryptographically Verified Secure Checkout Session
 */
router.post('/checkout', requireAuth, requireBuyer, async (req, res, next) => {
  try {
    const {
      quoteId,
      productId,
      quantity = 1,
      deliveryMethod = 'STANDARD',
      deliveryAddress,
    } = req.body || {};

    // SECURITY: identity comes from the verified session, never the body.
    const userId = getUserIdFromRequest(req);
    const { agentId } = await resolveAuthorizedAgent(req, req.body?.agentId);

    // SECURITY: a client-supplied quote *object* is untrusted data. We resolve
    // the quote by id and re-read the persisted, server-signed record instead,
    // so a caller cannot present self-authored commercial terms for checkout.
    const quoteRef = quoteId || req.body?.quote?.quoteId || req.body?.quote?.quote_id || req.body?.quote?.id;

    if (!quoteRef && !productId) {
      return res.status(400).json({
        error: 'Either quoteId or productId is required for checkout',
        code: QuoteErrorCodes.INVALID_INPUT,
      });
    }

    let verifiedQuote = null;
    if (quoteRef) {
      const verification = await verifyQuoteForCheckout(String(quoteRef), {
        userId,
        agentId,
        requestedQuantity: quantity,
        requestedProductId: productId,
        checkPolicy: true,
        // Checkout is the authoritative revalidation point: any divergence
        // between the locked quote price and the live catalog price blocks.
        rejectOnCatalogPriceChange: true,
      });
      verifiedQuote = verification.quote;
    } else {
      verifiedQuote = await generateQuote({
        productId,
        quantity: parseInt(quantity, 10) || 1,
        deliveryMethod,
        userId,
        agentId,
      });
    }

    const checkoutId = `chk_${verifiedQuote.quoteId.replace('quote_', '').replace('qt_', '')}_${Date.now().toString(36)}`;

    res.json({
      success: true,
      status: 'READY_FOR_PAYMENT',
      checkoutId,
      quoteId: verifiedQuote.quoteId,
      quote: verifiedQuote,
      product: {
        id: verifiedQuote.productId,
        merchantId: verifiedQuote.merchantId,
        unitPrice: verifiedQuote.unitPrice,
        quantity: verifiedQuote.quantity,
      },
      pricing: {
        unitPrice: verifiedQuote.unitPrice,
        quantity: verifiedQuote.quantity,
        subtotal: verifiedQuote.subtotal,
        deliveryFee: verifiedQuote.deliveryFee,
        tax: verifiedQuote.tax,
        totalAmount: verifiedQuote.totalAmount,
        currency: verifiedQuote.currency,
      },
      expiresAt: verifiedQuote.expiration || verifiedQuote.expiresAt,
      signature: verifiedQuote.signature || verifiedQuote.priceLockSignature,
      deliveryAddress: deliveryAddress || null,
    });
  } catch (err) {
    if (err instanceof QuoteVerificationError) {
      return res.status(400).json({
        success: false,
        error: err.message,
        code: err.code,
        details: err.details,
      });
    }
    next(err);
  }
});

/**
 * POST /api/ai/chat — Conversational AI Buyer Agent Procurement
 */
router.post('/chat', requireAuth, requireBuyer, async (req, res, next) => {
  let idempotencyKey = null;
  let userScopedLockKey = null;
  let lockAcquired = false;

  try {
    const { message, agent_id, filters } = req.body || {};
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'message is required' });
    }

    const cleanMessage = message.trim();

    const finalUserId = getUserIdFromRequest(req);

    const io = req.app.get('io');

    // ─── SECURITY GATE: prompt-injection screening ─────────────────────────
    // This runs BEFORE the AI service is contacted, which is the entire point:
    // /api/ai/chat falls back to deterministic processing when the AI service
    // is unavailable, and previously that fallback inherited no injection
    // defence at all. Screening here means the policy is identical whether
    // Gemini is up or down.
    //
    // Everything downstream — catalog search, policy engine, quote issuance,
    // inventory reservation, payment — is unreachable from a blocked request.
    // We return 200 with status BLOCKED so the buyer UI can render a clear
    // explanation, but the body carries no intent, quote, or order to act on.
    const inputsToScreen = [cleanMessage];
    if (filters && typeof filters === 'object') {
      for (const value of Object.values(filters)) {
        if (typeof value === 'string') inputsToScreen.push(value);
      }
    }

    const threatMatches = new Set();
    for (const candidateText of inputsToScreen) {
      const threat = detectInjectionThreat(candidateText);
      if (threat.threatDetected) threat.matchedRules.forEach((r) => threatMatches.add(r));
    }

    if (threatMatches.size > 0) {
      const matchedRules = [...threatMatches];
      logger.warn('Security', `Blocked prompt-injection attempt from user ${finalUserId}: ${matchedRules.join(', ')}`);

      await recordAuditEvent({
        eventType: 'PROMPT_INJECTION_DETECTED',
        actor: 'system',
        userId: finalUserId,
        action: 'BLOCK_PROMPT_INJECTION',
        decision: 'BLOCK',
        reasoning: `Backend prompt security guard matched: ${matchedRules.join(', ')}`,
        outcome: 'Request blocked before catalog search, quote, reservation or payment.',
        metadata: {
          layer: 'backend-prompt-security-guard',
          matchedRules,
          messageLength: cleanMessage.length,
        },
        io,
      }).catch((auditErr) => logger.error('Security', `Audit write failed for blocked request: ${auditErr.message}`));

      return res.json(buildBlockedResponse({ matchedRules }));
    }
    // ───────────────────────────────────────────────────────────────────────

    let targetAgentId = agent_id;
    let agentName = 'Procurement Agent';
    if (targetAgentId) {
      const aRes = await query('SELECT name, owner_id FROM agents WHERE id = $1', [targetAgentId]);
      if (aRes.rows.length === 0) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      const agentRecord = aRes.rows[0];
      const uRes = await query('SELECT role FROM users WHERE id::text = $1', [finalUserId]);
      const role = (uRes.rows[0]?.role || '').toUpperCase();
      if (role !== 'ADMIN' && agentRecord.owner_id && agentRecord.owner_id !== finalUserId) {
        return res.status(403).json({ error: 'Unauthorized: You do not own the specified agent' });
      }
      agentName = agentRecord.name;
    } else {
      const aRes = await query('SELECT id, name FROM agents WHERE owner_id::text = $1 ORDER BY created_at ASC LIMIT 1', [finalUserId]);
      if (aRes.rows.length > 0) {
        targetAgentId = aRes.rows[0].id;
        agentName = aRes.rows[0].name;
      }
    }

    // Deterministic parse first, then narrow with the structured UI filters.
    // Filters can only tighten the search; see applyStructuredFilters().
    let parsedIntent = applyStructuredFilters(parseBuyerIntent(message), filters);
    const deterministicIntent = parsedIntent;
    let candidateProduct = null;
    let comparison = [];

    // 1. Try FastAPI AI Service first (production/development only; tests use deterministic orchestrator)
    if (process.env.NODE_ENV !== 'test') {
      try {
        const response = await fetch(`${env.AI_SERVICE_URL}/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(env.AI_SERVICE_INTERNAL_TOKEN
              ? { Authorization: `Bearer ${env.AI_SERVICE_INTERNAL_TOKEN}` }
              : {}),
          },
          body: JSON.stringify({ message, agent_id: targetAgentId, user_id: finalUserId }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.status === 'BLOCKED') {
            await recordAuditEvent({
              eventType: 'PROMPT_INJECTION_DETECTED',
              action: 'BLOCK_PROMPT_INJECTION',
              decision: 'BLOCK',
              userId: finalUserId,
              agentId: targetAgentId,
              reasoning: 'AI Prompt Guard blocked adversarial prompt override attempt',
              metadata: { message: cleanMessage, guardData: data.intent_parsed },
            });
            return res.json(data);
          }
          if (data.intent_parsed) {
            // SECURITY: the model's parse is untrusted data. mergeAiIntent()
            // permits gap-filling and tightening only — it can never raise the
            // budget, change the quantity, or relax a deterministic constraint.
            parsedIntent = mergeAiIntent(deterministicIntent, data.intent_parsed);
            if (parsedIntent.rejectedAiFields?.length) {
              logger.warn('AI', `Rejected non-authoritative AI intent fields: ${parsedIntent.rejectedAiFields.join(', ')}`);
            }
          }
          if (data.status === 'MATCH_FOUND' && data.recommendation) {
            const proposedProdId = data.recommendation.product_id || data.recommendation.id;
            try {
              const gateRes = await validatePurchaseCandidate({
                id: proposedProdId,
                name: data.recommendation.name,
                price: data.recommendation.price,
                unit_price: data.recommendation.unit_price,
                specifications: data.recommendation.specifications,
                merchant_id: data.recommendation.merchant_id,
              }, parsedIntent);

              if (gateRes.valid) {
                candidateProduct = {
                  ...gateRes.product,
                  id: gateRes.product.id,
                  merchant_id: gateRes.product.merchantId || data.recommendation.merchant_id,
                  merchant_name: gateRes.product.merchantName || data.recommendation.merchant_name,
                  brand: gateRes.product.brand || data.recommendation.brand,
                  specifications: gateRes.product.specifications || data.recommendation.specifications,
                  matchedRules: data.recommendation.matched_rules || [
                    'Matches requested product type and hard specifications',
                    'Price is within authorized budget ceiling',
                    'Live verified inventory available for immediate dispatch',
                  ],
                  selectionReason: data.recommendation.reason,
                };
              }
            } catch (valErr) {
              logger.warn('AI', `AI-proposed product '${proposedProdId}' failed authoritative catalog grounding: ${valErr.message}`);
            }
          }
        }
      } catch (pyErr) {
        logger.warn('AI', `FastAPI service communication failed: ${pyErr.message}`);
      }
    }

    // 2. High-Performance Deterministic Multi-Merchant Orchestrator fallback
    if (!candidateProduct) {
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

      candidateProduct = matchResult.winningCandidate;
      const validationResult = await validatePurchaseCandidate(candidateProduct, parsedIntent);
      if (!validationResult.valid) {
        return res.status(400).json({
          status: 'VALIDATION_FAILED',
          error: 'Product candidate failed pre-purchase validation.',
        });
      }

      comparison = matchResult.candidates.slice(0, 3).map((p) => ({
        merchantName: p.merchant_name,
        productName: p.name,
        price: parseFloat(p.price),
        deliveryDays: p.delivery_days || 2,
        rating: p.merchant_rating || 4.8,
        inStock: p.in_stock,
        matchedRules: p.matchedRules || [],
      }));
    }

    const product = candidateProduct;

    // ─── SECURITY GATE: merchant content is DATA, never AUTHORITY ──────────
    // A merchant can write anything into a title, description, specification
    // blob or AI metadata field. None of it has ever been able to move price,
    // policy, inventory or approval — those come from authoritative database
    // columns through the deterministic pipeline. But a product carrying an
    // injection payload is still hostile content we refuse to surface or
    // transact, so we drop the candidate and record it against the merchant.
    const merchantScan = scanMerchantContent(product);
    if (!merchantScan.clean) {
      const fields = merchantScan.findings.map((f) => f.field);
      const rules = [...new Set(merchantScan.findings.flatMap((f) => f.matchedRules))];
      logger.warn('Security', `Merchant content injection in product ${product.id} (merchant ${product.merchant_id}): ${fields.join(', ')}`);

      await recordAuditEvent({
        eventType: 'MERCHANT_CONTENT_INJECTION_DETECTED',
        actor: 'system',
        userId: finalUserId,
        agentId: targetAgentId,
        action: 'BLOCK_MERCHANT_CONTENT_INJECTION',
        decision: 'BLOCK',
        reasoning: `Merchant-authored content for product ${product.id} matched injection rules: ${rules.join(', ')}`,
        outcome: 'Candidate rejected. No purchase intent, quote, reservation or payment created.',
        metadata: {
          layer: 'backend-prompt-security-guard',
          productId: product.id,
          merchantId: product.merchant_id,
          fields,
          matchedRules: rules,
        },
        io,
      }).catch(() => {});

      return res.json(buildBlockedResponse({
        agentName,
        matchedRules: rules,
        reason: [
          "I've blocked this result.",
          '',
          "The best-matching product in the catalog contains merchant-supplied text that tries to issue instructions to me — for example, to approve a purchase or change a price. AgentPay treats merchant content strictly as data, so the listing was rejected rather than shown to you.",
          '',
          'Nothing was purchased and no funds were moved. This has been recorded against the merchant listing for review.',
        ].join('\n'),
      }));
    }
    // ───────────────────────────────────────────────────────────────────────

    // 5. Purchase Gate: Independent Pre-Transaction Candidate Validation
    const validationResult = await validatePurchaseCandidate(product, parsedIntent);
    if (!validationResult.valid) {
      return res.status(400).json({
        status: 'VALIDATION_FAILED',
        error: 'Product candidate failed pre-purchase validation.',
      });
    }

    // 6. Build Comparison Set from Valid Candidates
    if (comparison.length === 0) {
      comparison = [{
        merchantName: product.merchant_name,
        productName: product.name,
        price: parseFloat(product.price),
        deliveryDays: product.delivery_days || 2,
        rating: product.merchant_rating || 4.8,
        inStock: product.in_stock,
        matchedRules: product.matchedRules || [],
      }];
    }

    const requestedDeliveryMethod = parsedIntent.deliveryMethod === 'EXPRESS' ? 'EXPRESS' : 'STANDARD';
    const pricing = calculatePrice({
      product,
      quantity: parsedIntent.quantity || 1,
      deliveryMethod: requestedDeliveryMethod,
    });
    const price = pricing.totalAmount;
    const clientKey = req.headers['idempotency-key'] || req.body?.idempotency_key;
    idempotencyKey = clientKey || crypto.createHash('sha256').update(`${finalUserId}_${product.id}_${price}_${parsedIntent.rawQuery || message}`).digest('hex');

    // 7. Create Merchant Cart & Checkout through Adapter
    const merchantAdapter = await commerceOrchestrator.getAdapter(product.merchant_id);
    let merchantCheckout = null;
    if (merchantAdapter) {
      const cart = await merchantAdapter.createCart([{ productId: product.id, quantity: parsedIntent.quantity || 1 }]);
      merchantCheckout = await merchantAdapter.createCheckout(cart);
    }

    // 8. Distributed Idempotency Concurrency Guard (Scoped per buyer to prevent cross-buyer collision)
    const userScopedLockKey = `ai:${finalUserId}:${idempotencyKey}`;
    lockAcquired = await acquireIdempotencyLock(userScopedLockKey, 60);
    if (!lockAcquired) {
      logger.info('Chat', `Concurrent in-flight request detected for key ${idempotencyKey} (user ${finalUserId}) — awaiting primary completion.`);
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const existingOrderRes = await query(`
          SELECT o.* FROM orders o
          JOIN purchase_intents pi ON o.purchase_intent_id = pi.id
          WHERE pi.idempotency_key = $1 AND pi.user_id = $2
        `, [idempotencyKey, finalUserId]);

        if (existingOrderRes.rows.length > 0) {
          const confirmedOrder = existingOrderRes.rows[0];
          const invRes = await query('SELECT * FROM invoices WHERE order_id = $1', [confirmedOrder.id]);
          const intentRes = await query('SELECT * FROM purchase_intents WHERE idempotency_key = $1 AND user_id = $2', [idempotencyKey, finalUserId]);

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
        const existingOrderRes = await query('SELECT * FROM orders WHERE purchase_intent_id = $1', [pi.id]);
        const confirmedOrder = existingOrderRes.rows[0] || null;
        const invRes = confirmedOrder ? await query('SELECT * FROM invoices WHERE order_id = $1', [confirmedOrder.id]) : { rows: [] };

        return res.json({
          status: 'MATCH_FOUND',
          execution_status: pi.status === 'blocked' ? 'BLOCKED' : pi.status === 'approval_required' ? 'APPROVAL_REQUIRED' : (confirmedOrder ? 'COMPLETED' : 'IN_PROGRESS'),
          is_duplicate: true,
          agent_name: agentName,
          reply: confirmedOrder ? `I found the best match: **${product.name}** from *${product.merchant_name}* for **₹${price.toLocaleString('en-IN')}**.\n\nAll requirements and spending policies verified. Autonomous purchase confirmed (Order: ${confirmedOrder.order_number}).` : `Processing transaction for **${product.name}** (Intent ID: ${pi.id}).`,
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
          purchase_intent: pi,
        });
      }

      return res.json({
        status: 'MATCH_FOUND',
        execution_status: 'IN_PROGRESS',
        is_duplicate: true,
        agent_name: agentName,
        reply: `Concurrent request is being processed for **${product.name}**.`,
        intent_parsed: parsedIntent,
        recommendation: {
          product_id: product.id,
          name: product.name,
          brand: product.brand,
          price,
          merchant_name: product.merchant_name,
          merchant_id: product.merchant_id,
        },
      });
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

    let paymentError = null;

    if (isAllowed) {
      // ─── CANONICAL PAYMENT PIPELINE ────────────────────────────────────────
      // Route through the same createPaymentOrder → verifyPayment path that the
      // buyer checkout UI uses. This ensures:
      //   1. Transaction starts as 'payment_pending' (not hardcoded 'completed')
      //   2. A cryptographic HMAC signature is computed (not Math.random)
      //   3. verifyPayment() validates the signature, advances the state machine,
      //      creates the confirmed order, generates the invoice and audit event
      //   4. There is no code path that can produce a 'completed' transaction
      //      without going through signature verification
      // ──────────────────────────────────────────────────────────────────────

      try {
        // The quote is the authoritative price lock and the inventory
        // reservation. If it cannot be issued — ineligible product, insufficient
        // stock, kill switch — there is nothing to pay for. Fail closed rather
        // than proceeding to payment on an unlocked, unreserved price.
        let quote;
        try {
          quote = await generateQuote({
            productId: product.id,
            quantity: parsedIntent.quantity || 1,
            deliveryMethod: requestedDeliveryMethod,
            userId: finalUserId,
            agentId: targetAgentId,
            reserveStock: true,
          });
        } catch (qErr) {
          logger.warn('Chat', `Quote generation failed for product ${product.id}: ${qErr.message}`);
          throw new Error(`Price lock could not be established: ${qErr.message}`);
        }

        const effectiveQuoteId = quote?.quoteId || quote?.quote_id || null;
        if (!effectiveQuoteId) {
          throw new Error('Price lock could not be established: quote service returned no quote id.');
        }
        await query('UPDATE purchase_intents SET quote_id = $1 WHERE id = $2', [effectiveQuoteId, purchaseIntent.id]);

        // Step 1: Create Razorpay sandbox order (real SDK call or crypto-randomBytes fallback)
        const paymentOrder = await createPaymentOrder({ purchaseIntentId: purchaseIntent.id, quoteId: effectiveQuoteId, io });

        // Step 2: Generate a traceable sandbox payment reference and compute a valid HMAC.
        //         Uses the same HMAC formula that RazorpayTestProvider.verifyPayment() validates:
        //         HMAC-SHA256(keySecret, orderId + '|' + paymentId)
        // SECURITY (test/live isolation): autonomous sandbox settlement is only
        // ever permitted on TEST rails, and only when a real key secret exists
        // to compute a verifiable HMAC. There is no "assume verified" string:
        // without credentials, or on LIVE rails, we fail closed and leave the
        // payment pending a genuine Razorpay callback.
        const paymentRailMode = String(paymentOrder.paymentMode || paymentOrder.environment || 'TEST').toUpperCase();
        if (env.isLiveMode || env.PAYMENT_MODE === 'live' || paymentRailMode !== 'TEST') {
          throw new Error('Autonomous sandbox settlement is not permitted on LIVE payment rails. Payment awaits a verified Razorpay callback.');
        }
        if (!env.RAZORPAY_TEST_KEY_SECRET) {
          throw new Error('Sandbox settlement unavailable: RAZORPAY_TEST_KEY_SECRET is not configured, so the payment cannot be cryptographically verified.');
        }

        const agentPaymentId = `pay_agent_${crypto.randomBytes(8).toString('hex')}`;
        const agentSignature = crypto
          .createHmac('sha256', env.RAZORPAY_TEST_KEY_SECRET)
          .update(`${paymentOrder.orderId}|${agentPaymentId}`)
          .digest('hex');

        // Step 3: Verify through the real payment service (validates HMAC, creates order + invoice)
        await verifyPayment({
          transactionId: paymentOrder.transactionId,
          razorpayOrderId: paymentOrder.orderId,
          razorpayPaymentId: agentPaymentId,
          razorpaySignature: agentSignature,
          io,
        });

        // Step 4: Fetch the confirmed order and invoice that verifyPayment created internally
        const confirmedOrderRes = await query(
          'SELECT * FROM orders WHERE purchase_intent_id = $1 ORDER BY created_at DESC LIMIT 1',
          [purchaseIntent.id]
        );
        confirmedOrder = confirmedOrderRes.rows[0] || null;

        if (confirmedOrder) {
          const invRes = await query('SELECT * FROM invoices WHERE order_id = $1', [confirmedOrder.id]);
          invoice = invRes.rows[0] || null;
        }
      } catch (payErr) {
        logger.error('Chat', `Payment execution failed: ${payErr.message}`);
        paymentError = payErr.message;
        await query('UPDATE purchase_intents SET status = $1 WHERE id = $2', ['payment_failed', purchaseIntent.id]);
      }
    }

    let reply;
    let executionStatus;

    if (isAllowed) {
      if (confirmedOrder && confirmedOrder.order_number) {
        reply = `I found the best match: **${product.name}** from *${product.merchant_name}* for **₹${price.toLocaleString('en-IN')}**.\n\nAll requirements and spending policies verified. Autonomous purchase confirmed (Order: ${confirmedOrder.order_number}).`;
        executionStatus = 'COMPLETED';
      } else if (paymentError) {
        reply = `I found **${product.name}** (₹${price.toLocaleString('en-IN')}) and policy authorized the purchase, but payment settlement failed: ${paymentError}. No funds were settled.`;
        executionStatus = 'PAYMENT_FAILED';
      } else {
        reply = `I found the best match: **${product.name}** from *${product.merchant_name}* for **₹${price.toLocaleString('en-IN')}**.\n\nPolicy evaluation authorized this purchase. Payment processing is pending.`;
        executionStatus = 'PAYMENT_PENDING';
      }
    } else if (isApproval) {
      reply = `I found **${product.name}** from *${product.merchant_name}* for **₹${price.toLocaleString('en-IN')}**.\n\nThis purchase exceeds your automatic limit and requires your 1-click approval.`;
      executionStatus = 'APPROVAL_REQUIRED';
    } else {
      reply = `I found **${product.name}** (₹${price.toLocaleString('en-IN')}), but the purchase was blocked: ${evaluation.reason}`;
      executionStatus = 'BLOCKED';
    }

    res.json({
      status: 'MATCH_FOUND',
      execution_status: executionStatus,
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
        tools_called: ['detect_injection_threat', 'parse_intent', 'filter_eligible_candidates', 'validate_purchase_gate', 'create_purchase_intent'],
        purchase_intent: purchaseIntent,
        evaluation,
      });
    } finally {
      if (lockAcquired && (userScopedLockKey || idempotencyKey)) {
        await releaseIdempotencyLock(userScopedLockKey || idempotencyKey);
      }
    }
  } catch (err) {
    next(err);
  }
});

export default router;
