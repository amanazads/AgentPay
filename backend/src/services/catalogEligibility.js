/**
 * AgentPay Canonical AI Catalog Contract
 * ======================================
 *
 * PURPOSE
 * -------
 * One place that answers two questions, so no route can answer them differently:
 *
 *   1. "Which products may an AI buyer see and transact?"  -> AI_CATALOG_PREDICATE
 *   2. "What shape does a product have to an AI buyer?"    -> normalizeCatalogProduct()
 *
 * WHY IT IS CENTRALISED
 * ---------------------
 * The list endpoint and the single-product endpoint previously used different
 * SQL. The list endpoint treated NULL as trusted and never checked
 * commerce_eligible at all; the single-product endpoint applied NO eligibility
 * filter whatsoever, so `GET /api/ai/catalog/:id` happily returned test-lab,
 * inactive and commerce-ineligible products. Any divergence between those two
 * answers is a hole, so there is now exactly one predicate.
 *
 * FAIL-CLOSED SEMANTICS
 * ---------------------
 * A product is eligible only if it POSITIVELY asserts all four conditions:
 *
 *     is_test_lab       = false
 *     status            = 'ACTIVE'
 *     commerce_eligible = true
 *     in_stock          = true
 *
 * Note the absence of `OR ... IS NULL`. Unknown is not eligible. Migration 017
 * backfills legacy NULLs to explicit safe values and adds NOT NULL, so this
 * predicate cannot silently exclude rows that merely predate the columns.
 */

/**
 * The canonical SQL predicate. `p` is the products table alias.
 *
 * Kept as a bare fragment (no parameters) so it composes into any WHERE clause
 * without disturbing positional parameter numbering.
 */
export const AI_CATALOG_PREDICATE = `
  p.is_test_lab = false
  AND p.status = 'ACTIVE'
  AND p.commerce_eligible = true
  AND p.in_stock = true
`.trim();

/**
 * The canonical SELECT + JOIN used by every AI catalog read, so all AI-facing
 * routes hydrate the same columns and produce the same contract.
 */
export const AI_CATALOG_SELECT = `
  SELECT p.*,
         m.name        AS merchant_name,
         m.is_verified AS merchant_verified,
         m.rating      AS merchant_rating,
         m.risk_level  AS merchant_risk_level,
         m.tier        AS merchant_tier,
         pam.ai_summary,
         pam.target_audience,
         pam.use_cases,
         pam.keywords  AS ai_keywords,
         pam.specifications_normalized,
         pam.is_promoted
  FROM products p
  JOIN merchants m ON p.merchant_id = m.id
  LEFT JOIN product_ai_metadata pam ON pam.product_id = p.id
`.trim();

/** Delivery options offered by the demo fulfilment simulation. */
export const DELIVERY_OPTIONS = {
  standard: {
    name: 'Standard Surface Delivery',
    fee: 0,
    currency: 'INR',
    estimatedDays: 2,
    carrier: 'Simulated Standard Delivery (Demo)',
  },
  express: {
    name: 'Next-Day Express Air',
    fee: 199,
    currency: 'INR',
    estimatedDays: 1,
    carrier: 'Simulated Express Delivery (Demo)',
  },
};

/**
 * Normalizes a hydrated product row into the canonical `agentpay.catalog.v1`
 * item. Every AI-facing route returns exactly this shape.
 *
 * Truthfulness note: inventory reports the real column. The previous
 * `row.inventory ?? 25` fallback invented stock for products that had none,
 * which is precisely the kind of fabricated figure the deterministic pipeline
 * must never see.
 *
 * @param {object} row - A row from AI_CATALOG_SELECT
 * @returns {object} agentpay.catalog.v1 item
 */
export function normalizeCatalogProduct(row) {
  const quantity = Number.parseInt(row.inventory, 10);
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  const price = parseFloat(row.price);

  return {
    protocol: 'agentic-commerce/v1',
    schema: 'agentpay.catalog.v1',
    productId: row.id,
    sku: row.sku || `SKU-${String(row.id).substring(0, 8).toUpperCase()}`,
    title: row.name,
    description: row.description,
    category: row.category,
    productType: row.product_type || 'other',
    brand: row.brand || null,
    pricing: {
      amount: price,
      currency: row.currency || 'INR',
      formatted: `₹${price.toLocaleString('en-IN')}`,
      priceLockGuaranteed: true,
      priceLockDurationMinutes: 15,
    },
    inventory: {
      quantity: safeQuantity,
      inStock: Boolean(row.in_stock) && safeQuantity > 0,
      status: Boolean(row.in_stock) && safeQuantity > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
      minOrderQuantity: 1,
      maxOrderQuantity: Math.max(0, Math.min(safeQuantity, 5)),
    },
    specificationsNormalized: row.specifications_normalized || row.specifications || {},
    aiMetadata: {
      summary: row.ai_summary || null,
      targetAudience: row.target_audience || null,
      useCases: row.use_cases || null,
      keywords: row.ai_keywords || null,
      isPromoted: Boolean(row.is_promoted),
    },
    delivery: DELIVERY_OPTIONS,
    merchant: {
      id: row.merchant_id,
      name: row.merchant_name,
      isVerified: Boolean(row.merchant_verified),
      rating: row.merchant_rating === null || row.merchant_rating === undefined
        ? null
        : parseFloat(row.merchant_rating),
      riskLevel: row.merchant_risk_level || 'low',
      tier: row.merchant_tier || 'tier_1',
    },
    protocol_endpoints: {
      quoteUrl: '/api/ai/quote',
      checkoutUrl: '/api/ai/checkout',
      productUrl: `/api/ai/catalog/${row.id}`,
    },
  };
}

export default {
  AI_CATALOG_PREDICATE,
  AI_CATALOG_SELECT,
  DELIVERY_OPTIONS,
  normalizeCatalogProduct,
};
