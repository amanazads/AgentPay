import { Router } from 'express';
import { query } from '../config/database.js';
import { generateId, generateIdempotencyKey } from '../utils/helpers.js';
import { evaluatePurchaseIntent } from '../services/decisionEngine.js';
import { recordAuditEvent } from '../services/auditService.js';
import { getUserIdFromRequest } from '../utils/authUtils.js';

const router = Router();

// POST /api/purchase-intents — Create purchase intent & automatically evaluate
router.post('/', async (req, res, next) => {
  try {
    const {
      agent_id, user_id, product_id, merchant_id,
      amount, quantity = 1, ai_reasoning, ai_recommendation,
      auto_evaluate = true,
    } = req.body;

    if (!agent_id || !product_id || amount == null) {
      return res.status(400).json({ error: 'agent_id, product_id, and amount are required' });
    }

    // Lookup merchant_id from product if not provided
    let finalMerchantId = merchant_id;
    if (!finalMerchantId) {
      const prodRes = await query('SELECT merchant_id FROM products WHERE id = $1', [product_id]);
      finalMerchantId = prodRes.rows[0]?.merchant_id;
    }

    // Lookup user from token or query
    let finalUserId = getUserIdFromRequest(req) || user_id;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(finalUserId || '');
    if (!finalUserId || !isUuid) {
      const userRes = await query('SELECT id FROM users LIMIT 1');
      finalUserId = userRes.rows[0]?.id;
    }

    // Generate idempotency key
    const idempotencyKey = generateIdempotencyKey(agent_id, product_id, amount.toString(), Date.now().toString());

    const result = await query(`
      INSERT INTO purchase_intents
        (agent_id, user_id, product_id, merchant_id, amount, quantity, ai_reasoning, ai_recommendation, idempotency_key, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
      RETURNING *
    `, [agent_id, finalUserId, product_id, finalMerchantId, amount, quantity, ai_reasoning, ai_recommendation, idempotencyKey]);

    const createdIntent = result.rows[0];
    const io = req.app.get('io');

    // Record creation audit event
    await recordAuditEvent({
      eventType: 'PURCHASE_INTENT_CREATED',
      actor: 'agent',
      agentId: agent_id,
      userId: finalUserId,
      purchaseIntentId: createdIntent.id,
      action: 'CREATE_PURCHASE_INTENT',
      decision: 'PENDING',
      reasoning: ai_reasoning || 'AI Agent proposed purchase intent',
      outcome: 'Intent recorded, evaluating guardrails',
      metadata: { amount, quantity, productId: product_id },
      io,
    });

    if (io) {
      io.to('dashboard').emit('intent:created', createdIntent);
    }

    // Auto evaluate through Decision Engine if requested (default true)
    if (auto_evaluate) {
      const evalResult = await evaluatePurchaseIntent(createdIntent.id, io);
      return res.status(201).json({
        purchaseIntent: createdIntent,
        evaluation: evalResult,
      });
    }

    res.status(201).json({ purchaseIntent: createdIntent });
  } catch (err) { next(err); }
});

// GET /api/purchase-intents — List intents
router.get('/', async (req, res, next) => {
  try {
    const { agent_id, status, limit = 50, offset = 0 } = req.query;
    const userId = getUserIdFromRequest(req);
    const conditions = [];
    const values = [];
    let idx = 1;

    if (userId) { conditions.push(`pi.user_id::text = $${idx++}`); values.push(userId); }
    if (agent_id) { conditions.push(`pi.agent_id = $${idx++}`); values.push(agent_id); }
    if (status) { conditions.push(`pi.status = $${idx++}`); values.push(status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(parseInt(limit), parseInt(offset));

    const result = await query(`
      SELECT pi.*, p.name as product_name, p.price as product_price,
             m.name as merchant_name, a.name as agent_name
      FROM purchase_intents pi
      LEFT JOIN products p ON pi.product_id = p.id
      LEFT JOIN merchants m ON pi.merchant_id = m.id
      LEFT JOIN agents a ON pi.agent_id = a.id
      ${where}
      ORDER BY pi.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, values);

    res.json({ purchaseIntents: result.rows });
  } catch (err) { next(err); }
});

// GET /api/purchase-intents/:id — Get intent detail
router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT pi.*, p.name as product_name, p.price as product_price,
             p.description as product_description, p.specifications,
             m.name as merchant_name, m.is_verified as merchant_verified,
             a.name as agent_name, a.status as agent_status
      FROM purchase_intents pi
      LEFT JOIN products p ON pi.product_id = p.id
      LEFT JOIN merchants m ON pi.merchant_id = m.id
      LEFT JOIN agents a ON pi.agent_id = a.id
      WHERE pi.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase intent not found' });
    }
    res.json({ purchaseIntent: result.rows[0] });
  } catch (err) { next(err); }
});

// POST /api/purchase-intents/:id/evaluate — Explicit evaluate
router.post('/:id/evaluate', async (req, res, next) => {
  try {
    const io = req.app.get('io');
    const evaluation = await evaluatePurchaseIntent(req.params.id, io);
    res.json({ evaluation });
  } catch (err) { next(err); }
});

export default router;
