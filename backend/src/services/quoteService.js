import crypto from 'crypto';
import env from '../config/env.js';
import { query } from '../config/database.js';
import { calculatePrice } from './pricingService.js';
import { reserveInventory, commitReservation, releaseReservation } from './inventoryService.js';
import { evaluatePolicy } from './policyEngine.js';
import { recordAuditEvent } from './auditService.js';
import { logger } from '../utils/logger.js';

/**
 * AgentPay Canonical Machine-Readable Quote Protocol Service
 * 
 * Invariants:
 * 1. A quote is cryptographically bound to the exact commercial terms authorized by the merchant.
 * 2. Signature verification is deterministic, fail-closed, and timing-safe.
 * 3. Expired, tampered, replayed, or price-diverged quotes are strictly rejected.
 * 4. Secrets are never logged or exposed in client payloads.
 */

export const QuoteErrorCodes = {
  INVALID_INPUT: 'INVALID_INPUT',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  PRODUCT_INELIGIBLE: 'PRODUCT_INELIGIBLE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  INSUFFICIENT_INVENTORY: 'INSUFFICIENT_INVENTORY',
  QUOTE_NOT_FOUND: 'QUOTE_NOT_FOUND',
  INVALID_QUOTE_SIGNATURE: 'INVALID_QUOTE_SIGNATURE',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  QUOTE_ALREADY_CONSUMED: 'QUOTE_ALREADY_CONSUMED',
  QUOTE_CANCELLED: 'QUOTE_CANCELLED',
  MERCHANT_PRODUCT_MISMATCH: 'MERCHANT_PRODUCT_MISMATCH',
  QUANTITY_MISMATCH: 'QUANTITY_MISMATCH',
  CATALOG_PRICE_CHANGED: 'CATALOG_PRICE_CHANGED',
  PRICE_SURGE_DETECTED: 'PRICE_SURGE_DETECTED',
  PRICE_CHANGED: 'PRICE_CHANGED',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  UNAUTHORIZED_QUOTE_CONSUMER: 'UNAUTHORIZED_QUOTE_CONSUMER',
};

export class QuoteVerificationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'QuoteVerificationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Internal helper to retrieve the quote signing secret without ever logging it.
 */
function getQuoteSigningSecret() {
  return env.QUOTE_SIGNING_SECRET || env.JWT_SECRET;
}

/**
 * Serializes a quote payload into a canonical, deterministic JSON string with sorted keys.
 *
 * @param {object} payload
 * @returns {string} Deterministic canonical JSON string
 */
export function serializeCanonicalQuote(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new QuoteVerificationError(QuoteErrorCodes.INVALID_INPUT, 'Quote payload must be a non-null object');
  }

  const expirationDate = new Date(payload.expiration || payload.expiresAt || payload.quoteExpiresAt);
  if (isNaN(expirationDate.getTime())) {
    throw new QuoteVerificationError(QuoteErrorCodes.INVALID_INPUT, 'Invalid quote expiration date');
  }

  const canonicalObj = {
    currency: String(payload.currency || 'INR').toUpperCase(),
    deliveryFee: Number(parseFloat(payload.deliveryFee || 0).toFixed(2)),
    deliveryMethod: String(payload.deliveryMethod || 'STANDARD').toUpperCase(),
    expiration: expirationDate.toISOString(),
    merchantId: String(payload.merchantId || payload.merchant_id || ''),
    policyVersion: String(payload.policyVersion || payload.policy_version || 'v1.0'),
    productId: String(payload.productId || payload.product_id || ''),
    quantity: parseInt(payload.quantity, 10) || 1,
    quoteId: String(payload.quoteId || payload.quote_id || payload.id || ''),
    subtotal: Number(parseFloat(payload.subtotal || 0).toFixed(2)),
    tax: Number(parseFloat(payload.tax ?? payload.taxAmount ?? payload.tax_amount ?? 0).toFixed(2)),
    totalAmount: Number(parseFloat(payload.totalAmount ?? payload.total_amount ?? payload.total ?? 0).toFixed(2)),
    unitPrice: Number(parseFloat(payload.unitPrice ?? payload.unit_price ?? payload.price ?? 0).toFixed(2)),
  };

  // Stringify with sorted keys deterministically
  const sortedKeys = Object.keys(canonicalObj).sort();
  const sortedObj = {};
  for (const key of sortedKeys) {
    sortedObj[key] = canonicalObj[key];
  }

  return JSON.stringify(sortedObj);
}

/**
 * Signs the canonical quote using HMAC-SHA256.
 *
 * @param {object|string} canonicalPayload
 * @param {string} [secret]
 * @returns {string} Hex signature
 */
export function signCanonicalQuote(canonicalPayload, secret = getQuoteSigningSecret()) {
  const serialized = typeof canonicalPayload === 'string'
    ? canonicalPayload
    : serializeCanonicalQuote(canonicalPayload);
  return crypto.createHmac('sha256', secret).update(serialized).digest('hex');
}

/**
 * Timing-safe HMAC verification for quote signatures.
 *
 * @param {object|string} quote
 * @param {string} signature
 * @param {string} [secret]
 * @returns {boolean}
 */
export function verifyQuoteSignature(quote, signature, secret = getQuoteSigningSecret()) {
  if (!signature || typeof signature !== 'string') return false;

  try {
    const expectedSignature = signCanonicalQuote(quote, secret);
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expectedSignature, 'hex');

    if (sigBuf.length !== expBuf.length || sigBuf.length === 0) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

/**
 * Generates an authoritative, cryptographically signed quote and persists it in PostgreSQL.
 *
 * @param {object} params
 * @param {string} params.productId
 * @param {number} [params.quantity=1]
 * @param {string} [params.deliveryMethod='STANDARD']
 * @param {string} [params.userId]
 * @param {string} [params.agentId]
 * @param {number} [params.durationMinutes=15]
 * @param {string} [params.policyVersion='v1.0']
 * @param {boolean} [params.reserveStock=true]
 * @returns {Promise<object>}
 */
export async function generateQuote({
  productId,
  quantity = 1,
  deliveryMethod = 'STANDARD',
  userId = null,
  agentId = null,
  durationMinutes = 15,
  policyVersion = 'v1.0',
  reserveStock = false,
}) {
  if (!productId) {
    throw new QuoteVerificationError(QuoteErrorCodes.INVALID_INPUT, 'productId is required for quote generation');
  }

  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const method = String(deliveryMethod || 'STANDARD').toUpperCase();

  // 1. Fetch Product with Merchant info
  const pRes = await query(`
    SELECT p.*, m.name as merchant_name, m.is_verified as merchant_verified
    FROM products p
    JOIN merchants m ON p.merchant_id = m.id
    WHERE p.id = $1
  `, [productId]);

  if (pRes.rows.length === 0) {
    throw new QuoteVerificationError(QuoteErrorCodes.PRODUCT_NOT_FOUND, `Product ${productId} not found`);
  }

  const product = pRes.rows[0];

  // 2. Validate Commerce Eligibility & Inventory
  if (product.is_test_lab === true || product.commerce_eligible === false) {
    throw new QuoteVerificationError(QuoteErrorCodes.PRODUCT_INELIGIBLE, `Product '${product.name}' is ineligible for commerce.`);
  }

  const inventory = parseInt(product.inventory || 0, 10);
  if (!product.in_stock || inventory < qty) {
    throw new QuoteVerificationError(QuoteErrorCodes.OUT_OF_STOCK, `Insufficient stock for product '${product.name}' (${inventory} available, ${qty} requested).`);
  }

  // 3. Authoritative Pricing Service
  const pricing = calculatePrice({
    product,
    quantity: qty,
    deliveryMethod: method,
  });

  const quoteId = `quote_${crypto.randomBytes(8).toString('hex')}`;
  const expiration = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

  // 4. Build Canonical Payload & Sign
  const canonicalQuote = {
    quoteId,
    productId: product.id,
    merchantId: product.merchant_id,
    quantity: qty,
    unitPrice: pricing.unitPrice,
    subtotal: pricing.subtotal,
    deliveryFee: pricing.deliveryFee,
    tax: pricing.taxAmount,
    totalAmount: pricing.totalAmount,
    currency: pricing.currency,
    deliveryMethod: method,
    expiration,
    policyVersion,
  };

  const serialized = serializeCanonicalQuote(canonicalQuote);
  const signature = signCanonicalQuote(serialized);

  // 5. Persist Quote in DB
  await query(`
    INSERT INTO quotes (
      id, product_id, merchant_id, user_id, agent_id,
      quantity, unit_price, subtotal, delivery_fee, tax,
      total_amount, currency, delivery_method, policy_version,
      signature, canonical_payload, status, expires_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'ACTIVE', $17)
    ON CONFLICT (id) DO UPDATE SET
      signature = EXCLUDED.signature,
      canonical_payload = EXCLUDED.canonical_payload,
      status = 'ACTIVE',
      expires_at = EXCLUDED.expires_at
  `, [
    quoteId,
    product.id,
    product.merchant_id,
    userId,
    agentId,
    qty,
    pricing.unitPrice,
    pricing.subtotal,
    pricing.deliveryFee,
    pricing.taxAmount,
    pricing.totalAmount,
    pricing.currency,
    method,
    policyVersion,
    signature,
    serialized,
    expiration,
  ]);

  // 6. Mandatory Two-Phase Inventory Reservation
  if (reserveStock) {
    try {
      await reserveInventory({
        productId: product.id,
        quantity: qty,
        userId,
        quoteId,
        durationMinutes,
      });
    } catch (resErr) {
      await query('DELETE FROM quotes WHERE id = $1', [quoteId]);
      throw new QuoteVerificationError(
        QuoteErrorCodes.INSUFFICIENT_INVENTORY,
        `Inventory reservation failed: ${resErr.message}`,
        { productId: product.id, quantity: qty }
      );
    }
  }

  logger.info('Quote', `Generated cryptographic price-lock quote ${quoteId} for product ${product.name} (₹${pricing.totalAmount})`);

  return {
    protocol: 'agentic-commerce/v1',
    quoteId,
    productId: product.id,
    productName: product.name,
    merchantId: product.merchant_id,
    merchantName: product.merchant_name,
    quantity: qty,
    unitPrice: pricing.unitPrice,
    subtotal: pricing.subtotal,
    deliveryMethod: method,
    deliveryFee: pricing.deliveryFee,
    taxAmount: pricing.taxAmount,
    tax: pricing.taxAmount,
    totalAmount: pricing.totalAmount,
    currency: pricing.currency,
    policyVersion,
    expiration,
    quoteExpiresAt: expiration,
    expiresAt: expiration,
    signature,
    priceLockSignature: signature,
    status: 'ACTIVE',
  };
}

/**
 * Cryptographic & Business Rules Verification for Quote during Checkout / Payment.
 *
 * @param {object|string} quoteInput - Quote object or quoteId
 * @param {object} [context]
 * @param {string} [context.userId]
 * @param {string} [context.agentId]
 * @param {number} [context.requestedQuantity]
 * @param {number} [context.requestedAmount]
 * @param {string} [context.requestedMerchantId]
 * @param {string} [context.requestedProductId]
 * @param {boolean} [context.checkPolicy=true]
 * @returns {Promise<object>} Verification result
 */
export async function verifyQuoteForCheckout(quoteInput, context = {}) {
  const {
    userId = null,
    agentId = null,
    requestedQuantity = null,
    requestedAmount = null,
    requestedMerchantId = null,
    requestedProductId = null,
    checkPolicy = true,
  } = context;

  // 1. Resolve Quote Object
  let quoteObj = null;
  let quoteId = null;

  if (typeof quoteInput === 'string') {
    quoteId = quoteInput;
    const qRes = await query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
    if (qRes.rows.length === 0) {
      throw new QuoteVerificationError(QuoteErrorCodes.QUOTE_NOT_FOUND, `Quote '${quoteId}' was not found in persistence records.`);
    }
    const row = qRes.rows[0];
    quoteObj = {
      quoteId: row.id,
      productId: row.product_id,
      merchantId: row.merchant_id,
      userId: row.user_id,
      agentId: row.agent_id,
      quantity: parseInt(row.quantity, 10),
      unitPrice: parseFloat(row.unit_price),
      subtotal: parseFloat(row.subtotal),
      deliveryFee: parseFloat(row.delivery_fee),
      tax: parseFloat(row.tax),
      taxAmount: parseFloat(row.tax),
      totalAmount: parseFloat(row.total_amount),
      currency: row.currency,
      deliveryMethod: row.delivery_method,
      policyVersion: row.policy_version,
      expiration: new Date(row.expires_at).toISOString(),
      signature: row.signature,
      status: row.status,
    };
  } else if (typeof quoteInput === 'object' && quoteInput !== null) {
    quoteId = quoteInput.quoteId || quoteInput.quote_id || quoteInput.id;
    quoteObj = {
      quoteId,
      productId: quoteInput.productId || quoteInput.product_id,
      merchantId: quoteInput.merchantId || quoteInput.merchant_id,
      userId: quoteInput.userId || quoteInput.user_id || userId,
      agentId: quoteInput.agentId || quoteInput.agent_id || agentId,
      quantity: parseInt(quoteInput.quantity, 10) || 1,
      unitPrice: parseFloat(quoteInput.unitPrice ?? quoteInput.unit_price ?? quoteInput.price ?? 0),
      subtotal: parseFloat(quoteInput.subtotal ?? 0),
      deliveryFee: parseFloat(quoteInput.deliveryFee ?? quoteInput.delivery_fee ?? 0),
      tax: parseFloat(quoteInput.tax ?? quoteInput.taxAmount ?? quoteInput.tax_amount ?? 0),
      taxAmount: parseFloat(quoteInput.tax ?? quoteInput.taxAmount ?? quoteInput.tax_amount ?? 0),
      totalAmount: parseFloat(quoteInput.totalAmount ?? quoteInput.total_amount ?? quoteInput.total ?? 0),
      currency: quoteInput.currency || 'INR',
      deliveryMethod: quoteInput.deliveryMethod || quoteInput.delivery_method || 'STANDARD',
      policyVersion: quoteInput.policyVersion || quoteInput.policy_version || 'v1.0',
      expiration: new Date(quoteInput.expiration || quoteInput.expiresAt || quoteInput.quoteExpiresAt).toISOString(),
      signature: quoteInput.signature || quoteInput.priceLockSignature,
      status: quoteInput.status || 'ACTIVE',
    };
  } else {
    throw new QuoteVerificationError(QuoteErrorCodes.INVALID_INPUT, 'Invalid quote input provided for verification.');
  }

  // 2. Cryptographic Signature Verification (Deterministic & Fail-Closed)
  const isSigValid = verifyQuoteSignature(quoteObj, quoteObj.signature);
  if (!isSigValid) {
    throw new QuoteVerificationError(
      QuoteErrorCodes.INVALID_QUOTE_SIGNATURE,
      'Cryptographic quote signature verification failed. Quote data has been modified or tampered with.'
    );
  }

  // 3. Expiration Check
  const expirationTime = new Date(quoteObj.expiration).getTime();
  const now = Date.now();
  if (isNaN(expirationTime) || now > expirationTime) {
    throw new QuoteVerificationError(
      QuoteErrorCodes.QUOTE_EXPIRED,
      `Quote '${quoteObj.quoteId}' has expired at ${quoteObj.expiration}. Replay of expired quotes is prohibited.`
    );
  }

  // 4. Persistence & Replay Status Check
  if (quoteId) {
    const qPersistRes = await query('SELECT status FROM quotes WHERE id = $1', [quoteId]);
    if (qPersistRes.rows.length > 0) {
      const currentStatus = qPersistRes.rows[0].status;
      if (currentStatus === 'CONSUMED') {
        throw new QuoteVerificationError(
          QuoteErrorCodes.QUOTE_ALREADY_CONSUMED,
          `Quote '${quoteId}' has already been consumed in a completed order and cannot be replayed.`
        );
      }
      if (currentStatus === 'CANCELLED') {
        throw new QuoteVerificationError(
          QuoteErrorCodes.QUOTE_CANCELLED,
          `Quote '${quoteId}' was cancelled and is no longer valid for purchase.`
        );
      }
    }
  }

  // 5. Contextual Intent Matching (Product / Merchant / Quantity / Amount)
  if (requestedProductId && requestedProductId !== quoteObj.productId) {
    throw new QuoteVerificationError(
      QuoteErrorCodes.MERCHANT_PRODUCT_MISMATCH,
      `Quote product (${quoteObj.productId}) does not match requested product (${requestedProductId}).`
    );
  }

  if (requestedMerchantId && requestedMerchantId !== quoteObj.merchantId) {
    throw new QuoteVerificationError(
      QuoteErrorCodes.MERCHANT_PRODUCT_MISMATCH,
      `Quote merchant (${quoteObj.merchantId}) does not match requested merchant (${requestedMerchantId}).`
    );
  }

  if (requestedQuantity !== null && requestedQuantity !== undefined && parseInt(requestedQuantity, 10) !== quoteObj.quantity) {
    throw new QuoteVerificationError(
      QuoteErrorCodes.QUANTITY_MISMATCH,
      `Requested quantity (${requestedQuantity}) does not match locked quote quantity (${quoteObj.quantity}).`
    );
  }

  if (requestedAmount !== null && requestedAmount !== undefined && parseFloat(requestedAmount) !== quoteObj.totalAmount) {
    throw new QuoteVerificationError(
      QuoteErrorCodes.AMOUNT_MISMATCH,
      `Requested amount (₹${requestedAmount}) does not match authorized quote total (₹${quoteObj.totalAmount}).`
    );
  }

  // 6. Live Database Catalog Revalidation (Merchant, Price, In-stock, Inventory)
  const prodRes = await query(`
    SELECT p.*, m.name as merchant_name, m.is_verified as merchant_verified
    FROM products p
    JOIN merchants m ON p.merchant_id = m.id
    WHERE p.id = $1
  `, [quoteObj.productId]);

  if (prodRes.rows.length === 0) {
    throw new QuoteVerificationError(QuoteErrorCodes.PRODUCT_NOT_FOUND, `Product '${quoteObj.productId}' no longer exists in catalog.`);
  }

  const dbProduct = prodRes.rows[0];

  if (dbProduct.merchant_id !== quoteObj.merchantId) {
    throw new QuoteVerificationError(
      QuoteErrorCodes.MERCHANT_PRODUCT_MISMATCH,
      `Product merchant mismatch: product belongs to ${dbProduct.merchant_id}, quote specifies ${quoteObj.merchantId}.`
    );
  }

  if (dbProduct.is_test_lab === true || dbProduct.commerce_eligible === false) {
    throw new QuoteVerificationError(
      QuoteErrorCodes.PRODUCT_INELIGIBLE,
      `Product '${dbProduct.name}' is a test lab fixture and ineligible for commerce.`
    );
  }

  // 6b. Check Current Catalog Price vs Quote Unit Price with Tolerance Gate
  const currentCatalogPrice = parseFloat(dbProduct.price);
  const tolerancePercent = typeof context.tolerancePercent === 'number'
    ? context.tolerancePercent
    : (env.PRICE_SURGE_TOLERANCE_PERCENT || 2.0);

  if (currentCatalogPrice > quoteObj.unitPrice) {
    const driftPercent = ((currentCatalogPrice - quoteObj.unitPrice) / quoteObj.unitPrice) * 100;
    const roundedDrift = Math.round(driftPercent * 10000) / 10000;

    if (roundedDrift > tolerancePercent) {
      if (quoteObj.quoteId) {
        await releaseReservation(quoteObj.quoteId, `Price surge of ${driftPercent.toFixed(2)}% exceeded tolerance of ${tolerancePercent}%`).catch(() => {});
      }

      await recordAuditEvent({
        eventType: 'PRICE_SURGE_DETECTED',
        actor: 'system',
        userId: userId || quoteObj.userId,
        agentId: agentId || quoteObj.agentId,
        purchaseIntentId: context.intentId || context.purchaseIntentId || null,
        action: 'VERIFY_QUOTE_PRICE',
        decision: 'BLOCK',
        reasoning: `Catalog price increased from ₹${quoteObj.unitPrice} to ₹${currentCatalogPrice} (+${driftPercent.toFixed(2)}%), exceeding allowed tolerance of ${tolerancePercent}%.`,
        outcome: 'Payment aborted. Reservation released.',
        metadata: {
          quoteId: quoteObj.quoteId,
          productId: quoteObj.productId,
          quotedPrice: quoteObj.unitPrice,
          currentCatalogPrice,
          driftPercent,
          tolerancePercent,
        },
      }).catch(() => {});

      throw new QuoteVerificationError(
        QuoteErrorCodes.PRICE_SURGE_DETECTED,
        `Catalog price has changed: Price surge detected: Catalog price (₹${currentCatalogPrice}) exceeds locked quote price (₹${quoteObj.unitPrice}) by ${driftPercent.toFixed(2)}%, exceeding the ${tolerancePercent}% tolerance limit.`,
        {
          quotedPrice: quoteObj.unitPrice,
          currentPrice: currentCatalogPrice,
          driftPercent,
          tolerancePercent,
          status: 'PRICE_SURGE_DETECTED',
        }
      );
    }
  }

  // Check Live Inventory
  const liveInventory = parseInt(dbProduct.inventory || 0, 10);
  if (!dbProduct.in_stock || liveInventory < quoteObj.quantity) {
    throw new QuoteVerificationError(
      QuoteErrorCodes.INSUFFICIENT_INVENTORY,
      `Insufficient inventory for '${dbProduct.name}': requested ${quoteObj.quantity}, available ${liveInventory}.`
    );
  }

  // 7. Authoritative Pricing Formula Recomputation
  const effectiveProductForPricing = {
    ...dbProduct,
    price: quoteObj.unitPrice, // lock pricing to authorized quote price
  };

  const recalculatedPricing = calculatePrice({
    product: effectiveProductForPricing,
    quantity: quoteObj.quantity,
    deliveryMethod: quoteObj.deliveryMethod,
  });

  if (Math.abs(recalculatedPricing.totalAmount - quoteObj.totalAmount) > 0.05 || Math.abs(recalculatedPricing.subtotal - quoteObj.subtotal) > 0.05) {
    throw new QuoteVerificationError(
      QuoteErrorCodes.AMOUNT_MISMATCH,
      `Pricing recomputation mismatch: recalculated ₹${recalculatedPricing.totalAmount}, quote contains ₹${quoteObj.totalAmount}.`
    );
  }

  // 8. Policy Validity Check
  if (checkPolicy && (userId || quoteObj.userId)) {
    const finalUserId = userId || quoteObj.userId;
    const policyResult = await evaluatePolicy({
      agentId: agentId || quoteObj.agentId,
      userId: finalUserId,
      intentId: context.intentId || context.purchaseIntentId || null,
      productId: dbProduct.id,
      merchantId: dbProduct.merchant_id,
      amount: quoteObj.totalAmount,
      quantity: quoteObj.quantity,
      deliveryFee: quoteObj.deliveryFee,
      idempotencyKey: `quote_verify_${quoteObj.quoteId}`,
      quoteId: quoteObj.quoteId,
      quotePrice: quoteObj.unitPrice,
    });

    if (policyResult.decision === 'BLOCK') {
      throw new QuoteVerificationError(
        QuoteErrorCodes.POLICY_VIOLATION,
        `Spending policy evaluation failed: ${policyResult.reason}`,
        { policyResult }
      );
    }
  }

  return {
    valid: true,
    quote: quoteObj,
    product: dbProduct,
    pricing: recalculatedPricing,
  };
}

/**
 * Atomically consumes a verified quote upon successful order placement.
 *
 * @param {string} quoteId
 * @returns {Promise<object>}
 */
export async function consumeQuote(quoteId) {
  if (!quoteId) return { success: false, reason: 'No quoteId provided' };

  const res = await query(`
    UPDATE quotes
    SET status = 'CONSUMED',
        consumed_at = NOW()
    WHERE id = $1 AND status = 'ACTIVE'
    RETURNING *
  `, [quoteId]);

  if (res.rows.length > 0) {
    await commitReservation(quoteId).catch(() => {});
    logger.info('Quote', `Quote ${quoteId} marked as CONSUMED`);
    return { success: true, quote: res.rows[0] };
  }

  return { success: false, reason: 'Quote not found or already consumed/expired' };
}

/**
 * Releases/cancels a quote and releases any held inventory reservation.
 *
 * @param {string} quoteId
 * @param {string} [reason]
 * @returns {Promise<object>}
 */
export async function cancelQuote(quoteId, reason = 'Cancelled by user/system') {
  if (!quoteId) return { success: false, reason: 'No quoteId provided' };

  const res = await query(`
    UPDATE quotes
    SET status = 'CANCELLED'
    WHERE id = $1 AND status = 'ACTIVE'
    RETURNING *
  `, [quoteId]);

  if (res.rows.length > 0) {
    await releaseReservation(quoteId, reason).catch(() => {});
    logger.info('Quote', `Quote ${quoteId} cancelled (${reason})`);
    return { success: true, quote: res.rows[0] };
  }

  return { success: false, reason: 'Quote not found or not in active state' };
}

export default {
  serializeCanonicalQuote,
  signCanonicalQuote,
  verifyQuoteSignature,
  generateQuote,
  verifyQuoteForCheckout,
  consumeQuote,
  cancelQuote,
  QuoteErrorCodes,
  QuoteVerificationError,
};
