/**
 * AgentPay Canonical Pricing Service
 *
 * Single source of truth for all monetary calculations.
 * Pure function — no database access, no side effects.
 *
 * ── Canonical Model ──────────────────────────────────────────────────────────
 *
 *   subtotal       = unitPrice × quantity
 *   deliveryFee    = EXPRESS → DELIVERY_FEE_EXPRESS (₹199)
 *                    STANDARD → product.delivery_fee from DB (default ₹0)
 *   taxAmount      = Math.round(subtotal × TAX_RATE × 100) / 100  ← display only
 *   discountAmount = 0 (reserved)
 *   totalAmount    = subtotal + deliveryFee − discountAmount  ← the payable amount
 *
 *   Tax is a DISPLAY field. It is NOT added to totalAmount.
 *   totalAmount is the exact amount charged via Razorpay.
 *
 * ── Invariant ────────────────────────────────────────────────────────────────
 *
 *   quote.totalAmount
 *     === purchase_intent.amount
 *     === transaction.amount
 *     === order.total_amount
 *     === invoice.total_amount
 *
 *   for the same purchase.
 */

import { query } from '../config/database.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** 18% GST — applied to subtotal for structured tax reporting */
export const TAX_RATE = 0.18;

/** Express delivery fee (Next-Day Air), in rupees */
export const DELIVERY_FEE_EXPRESS = 199;

/**
 * Standard delivery free-shipping threshold (rupees).
 * Carts with subtotal >= this get free standard shipping.
 * Used by the merchant adapter cart/checkout display logic.
 */
export const STANDARD_SHIPPING_THRESHOLD = 2000;

/**
 * Standard delivery fee for low-value carts (subtotal < threshold), in rupees.
 * Used by the merchant adapter cart/checkout display logic.
 */
export const DELIVERY_FEE_STANDARD_LOW_VALUE = 99;

/** ISO 4217 default currency for AgentPay */
export const CURRENCY = 'INR';

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Round a currency value to 2 decimal places deterministically.
 * @param {number|string} value
 * @returns {number}
 */
export function roundCurrency(value) {
  return Math.round((parseFloat(value) || 0) * 100) / 100;
}

/**
 * Convert a rupee amount to an integer paise value for the Razorpay API.
 * Uses Math.round to prevent floating-point drift at the sub-paise boundary.
 *
 * @param {number|string} rupees
 * @returns {number} integer paise
 */
export function toRazorpayAmount(rupees) {
  return Math.round((parseFloat(rupees) || 0) * 100);
}

/**
 * Convert a Razorpay paise integer back to rupees.
 *
 * @param {number|string} paise
 * @returns {number} rupees
 */
export function fromRazorpayAmount(paise) {
  return Math.round(parseFloat(paise) || 0) / 100;
}

// ── Core Pricing Function ─────────────────────────────────────────────────────

/**
 * Calculate the canonical price breakdown for a purchase.
 *
 * All callers (quote, checkout, payment order, order creation, invoice) MUST
 * use this function. Never compute subtotal / deliveryFee / tax independently.
 *
 * @param {object}  opts
 * @param {object}  opts.product           - Product row with at least { price, delivery_fee, currency }
 * @param {number}  [opts.quantity=1]      - Unit count (must be ≥ 1)
 * @param {string}  [opts.deliveryMethod='STANDARD'] - 'STANDARD' | 'EXPRESS'
 * @param {number}  [opts.discountAmount=0] - Pre-validated discount in rupees
 * @param {number}  [opts.taxRate]         - Override TAX_RATE (for testing)
 *
 * @returns {{
 *   unitPrice:          number,   // per-unit price in rupees
 *   quantity:           number,   // normalised integer quantity
 *   subtotal:           number,   // unitPrice × quantity
 *   subtotalInPaise:    number,   // subtotal in integer paise
 *   deliveryFee:        number,   // delivery fee in rupees
 *   deliveryFeeInPaise: number,   // delivery fee in integer paise
 *   taxAmount:          number,   // GST tax amount in rupees
 *   tax:                number,   // alias for taxAmount
 *   taxInPaise:         number,   // tax in integer paise
 *   discountAmount:     number,   // discount in rupees
 *   discount:           number,   // alias for discountAmount
 *   discountInPaise:    number,   // discount in integer paise
 *   totalAmount:        number,   // the payable amount (= subtotal + deliveryFee − discount)
 *   amountInPaise:      number,   // total payable amount in integer paise
 *   totalInPaise:       number,   // alias for amountInPaise
 *   currency:           string,
 *   deliveryMethod:     string,
 *   breakdown:          object,   // human-readable strings for logging / display
 * }}
 */
export function calculatePrice({
  product,
  quantity = 1,
  deliveryMethod = 'STANDARD',
  discountAmount = 0,
  taxRate = TAX_RATE,
}) {
  if (!product || product.price === undefined || product.price === null) {
    throw new Error('[pricingService] calculatePrice: product.price is required');
  }

  const unitPrice = roundCurrency(product.price);
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const method = (String(deliveryMethod || 'STANDARD')).toUpperCase();

  // 1. Subtotal in integer paise and rupees
  const unitPriceInPaise = Math.round(unitPrice * 100);
  const subtotalInPaise = unitPriceInPaise * qty;
  const subtotal = subtotalInPaise / 100;

  // 2. Delivery fee
  //    EXPRESS: always DELIVERY_FEE_EXPRESS
  //    STANDARD: use the product's stored delivery_fee column (default 0)
  const deliveryFee = method === 'EXPRESS'
    ? DELIVERY_FEE_EXPRESS
    : roundCurrency(product.delivery_fee ?? product.deliveryFee ?? 0);
  const deliveryFeeInPaise = Math.round(deliveryFee * 100);

  // 3. Tax (18% GST for structured tax calculation / display)
  const taxInPaise = Math.round(subtotalInPaise * taxRate);
  const taxAmount = taxInPaise / 100;

  // 4. Discount (cannot exceed subtotal)
  const requestedDiscountInPaise = Math.round((parseFloat(discountAmount) || 0) * 100);
  const safeDiscountInPaise = Math.min(Math.max(0, requestedDiscountInPaise), subtotalInPaise);
  const safeDiscount = safeDiscountInPaise / 100;

  // 5. Payable total (subtotal + deliveryFee - discount)
  const totalInPaise = subtotalInPaise + deliveryFeeInPaise - safeDiscountInPaise;
  const totalAmount = totalInPaise / 100;

  const fmt = (n) => `₹${n.toLocaleString('en-IN')}`;

  return {
    unitPrice,
    quantity: qty,
    subtotal,
    subtotalInPaise,
    deliveryFee,
    deliveryFeeInPaise,
    taxAmount,
    tax: taxAmount,
    taxInPaise,
    discountAmount: safeDiscount,
    discount: safeDiscount,
    discountInPaise: safeDiscountInPaise,
    totalAmount,
    amountInPaise: totalInPaise,
    totalInPaise,
    currency: product.currency || CURRENCY,
    deliveryMethod: method,
    taxIncluded: false,
    breakdown: {
      unitPrice:      fmt(unitPrice),
      quantity:       qty,
      subtotal:       fmt(subtotal),
      deliveryFee:    fmt(deliveryFee),
      taxAmount:      `${fmt(taxAmount)} (${(taxRate * 100).toFixed(0)}% GST — display/reporting)`,
      discountAmount: fmt(safeDiscount),
      totalAmount:    fmt(totalAmount),
      taxNote:        'Tax is structured GST. totalAmount is the authoritative payable amount.',
    },
  };
}

/**
 * Resolves product directly from the database and calculates authoritative pricing.
 * Ensures fresh catalog price and inventory before checkout.
 *
 * @param {string|object} productOrId
 * @param {object} [options]
 * @returns {Promise<{ product: object, pricing: object }>}
 */
export async function resolveProductPricing(productOrId, options = {}) {
  let product = null;

  if (typeof productOrId === 'string') {
    const pRes = await query('SELECT * FROM products WHERE id = $1', [productOrId]);
    if (pRes.rows.length === 0) {
      throw new Error(`Product '${productOrId}' not found in database.`);
    }
    product = pRes.rows[0];
  } else if (typeof productOrId === 'object' && productOrId !== null) {
    if (productOrId.id && (!productOrId.price || productOrId.price === undefined)) {
      const pRes = await query('SELECT * FROM products WHERE id = $1', [productOrId.id]);
      if (pRes.rows.length > 0) {
        product = pRes.rows[0];
      }
    }
    if (!product) {
      product = productOrId;
    }
  } else {
    throw new Error('Invalid product input for pricing resolution.');
  }

  const pricing = calculatePrice({
    product,
    quantity: options.quantity || 1,
    deliveryMethod: options.deliveryMethod || 'STANDARD',
    discountAmount: options.discountAmount || 0,
    taxRate: options.taxRate || TAX_RATE,
  });

  return { product, pricing };
}

export default {
  calculatePrice,
  resolveProductPricing,
  roundCurrency,
  toRazorpayAmount,
  fromRazorpayAmount,
  TAX_RATE,
  DELIVERY_FEE_EXPRESS,
  STANDARD_SHIPPING_THRESHOLD,
  DELIVERY_FEE_STANDARD_LOW_VALUE,
  CURRENCY,
};
