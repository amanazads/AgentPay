/**
 * Merchant Product Input Validation (§12)
 * =======================================
 *
 * Merchant-submitted product data is UNTRUSTED INPUT, whether it was typed by a
 * merchant or produced by the AI autofill helper. It reaches columns that the
 * deterministic commerce pipeline reads as authoritative — price, inventory,
 * category, product type, eligibility — so it is validated here before it can
 * become catalog truth.
 *
 * What this guards against:
 *   - negative or non-numeric prices and inventory
 *   - absurd values that would break policy arithmetic
 *   - unknown categories / product types that defeat category isolation
 *   - malformed specifications (arrays, strings, unbounded blobs)
 *   - injection payloads written into product text
 *   - a merchant setting fields that only the platform may set
 *
 * What it deliberately does NOT do: it never grants eligibility. A merchant can
 * describe a product; only the canonical catalog predicate decides whether an
 * AI buyer may transact it.
 */

import { detectInjectionThreat } from './promptSecurityGuard.js';

export class MerchantProductValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MerchantProductValidationError';
    this.status = 400;
    this.details = details;
  }
}

/** Categories the catalog and policy engine understand. */
export const VALID_CATEGORIES = [
  'Electronics', 'Peripherals', 'Furniture', 'Software & Licenses',
  'Office Supplies', 'Networking', 'Storage', 'Accessories',
];

/** Product types the deterministic intent parser can isolate on. */
export const VALID_PRODUCT_TYPES = [
  'power_bank', 'charger', 'headphones', 'laptop', 'monitor', 'mouse',
  'keyboard', 'chair', 'desk', 'smartphone', 'dock', 'software', 'other',
];

/** Lifecycle statuses permitted by the products CHECK constraint. */
export const VALID_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED', 'DRAFT', 'PAUSED'];

const MAX_PRICE = 10000000;      // ₹1 crore — beyond this is a data-entry error
const MAX_INVENTORY = 1000000;
const MAX_NAME = 500;
const MAX_TEXT = 5000;
const MAX_SPEC_KEYS = 50;

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * Validates and normalizes a price.
 * @returns {number}
 */
export function validatePrice(value, { required = true } = {}) {
  if (isBlank(value)) {
    if (required) throw new MerchantProductValidationError('A product price is required.');
    return undefined;
  }
  const price = Number.parseFloat(value);
  if (!Number.isFinite(price)) {
    throw new MerchantProductValidationError('Price must be a number.', { received: value });
  }
  if (price <= 0) {
    throw new MerchantProductValidationError('Price must be greater than zero.', { received: price });
  }
  if (price > MAX_PRICE) {
    throw new MerchantProductValidationError(
      `Price exceeds the maximum permitted catalog value (₹${MAX_PRICE.toLocaleString('en-IN')}).`,
      { received: price }
    );
  }
  // Two decimal places; money is never carried at arbitrary precision.
  return Math.round(price * 100) / 100;
}

/**
 * Validates and normalizes an inventory count.
 * @returns {number}
 */
export function validateInventory(value, { required = false, fallback = 0 } = {}) {
  if (isBlank(value)) {
    if (required) throw new MerchantProductValidationError('An inventory count is required.');
    return fallback;
  }
  const inventory = Number.parseInt(value, 10);
  if (!Number.isFinite(inventory)) {
    throw new MerchantProductValidationError('Inventory must be a whole number.', { received: value });
  }
  if (inventory < 0) {
    throw new MerchantProductValidationError('Inventory cannot be negative.', { received: inventory });
  }
  if (inventory > MAX_INVENTORY) {
    throw new MerchantProductValidationError(
      `Inventory exceeds the maximum permitted value (${MAX_INVENTORY.toLocaleString('en-IN')}).`,
      { received: inventory }
    );
  }
  return inventory;
}

/** Case-insensitive category resolution against the allowlist. */
export function validateCategory(value, { required = true, fallback = 'Electronics' } = {}) {
  if (isBlank(value)) {
    if (required) return fallback;
    return undefined;
  }
  const match = VALID_CATEGORIES.find((c) => c.toLowerCase() === String(value).trim().toLowerCase());
  if (!match) {
    throw new MerchantProductValidationError(
      `'${value}' is not a supported category.`,
      { received: value, allowed: VALID_CATEGORIES }
    );
  }
  return match;
}

/** Case-insensitive product-type resolution against the allowlist. */
export function validateProductType(value, { fallback = 'other' } = {}) {
  if (isBlank(value)) return fallback;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!VALID_PRODUCT_TYPES.includes(normalized)) {
    throw new MerchantProductValidationError(
      `'${value}' is not a supported product type.`,
      { received: value, allowed: VALID_PRODUCT_TYPES }
    );
  }
  return normalized;
}

/** Lifecycle status resolution. */
export function validateStatus(value, { fallback = 'ACTIVE' } = {}) {
  if (isBlank(value)) return fallback;
  const normalized = String(value).trim().toUpperCase();
  if (!VALID_STATUSES.includes(normalized)) {
    throw new MerchantProductValidationError(
      `'${value}' is not a valid product status.`,
      { received: value, allowed: VALID_STATUSES }
    );
  }
  return normalized;
}

/** SKU format and length. */
export function validateSku(value, { required = false } = {}) {
  if (isBlank(value)) {
    if (required) throw new MerchantProductValidationError('A SKU is required.');
    return undefined;
  }
  const sku = String(value).trim().toUpperCase();
  if (sku.length > 64) {
    throw new MerchantProductValidationError('SKU must be 64 characters or fewer.');
  }
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(sku)) {
    throw new MerchantProductValidationError(
      'SKU may contain only letters, digits, dots, hyphens and underscores, and must start with a letter or digit.',
      { received: value }
    );
  }
  return sku;
}

/**
 * Specifications must be a flat-ish JSON object with bounded size. Arrays and
 * strings are rejected outright: downstream matching reads `specifications` as
 * a keyed object, and a mis-shaped blob silently defeats spec constraints.
 */
export function validateSpecifications(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new MerchantProductValidationError('Specifications must be a JSON object of key/value pairs.');
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_SPEC_KEYS) {
    throw new MerchantProductValidationError(`Specifications may contain at most ${MAX_SPEC_KEYS} keys.`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 8000) {
    throw new MerchantProductValidationError('Specifications payload is too large (8KB maximum).');
  }
  for (const key of keys) {
    if (key.length > 60) {
      throw new MerchantProductValidationError(`Specification key '${key.slice(0, 20)}…' is too long.`);
    }
  }
  return value;
}

/**
 * Scans every merchant-authored text field for injection payloads.
 *
 * Rejected at write time rather than at read time, so a hostile listing never
 * enters the catalog in the first place. The read-time guards in candidateFilter
 * and purchaseGate remain as defence in depth for content that predates this.
 */
export function assertNoInjectionInMerchantText(fields) {
  for (const [field, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const threat = detectInjectionThreat(text);
    if (threat.threatDetected) {
      throw new MerchantProductValidationError(
        `The '${field}' field contains text that looks like an instruction to the AI buyer agent. `
        + 'Product content is treated strictly as data and cannot contain directives.',
        { field, matchedRules: threat.matchedRules }
      );
    }
  }
}

/**
 * Validates a full create payload. Returns normalized values ready to insert.
 */
export function validateProductCreate(body = {}) {
  const name = isBlank(body.name) ? null : String(body.name).trim();
  if (!name) throw new MerchantProductValidationError('A product name is required.');
  if (name.length > MAX_NAME) {
    throw new MerchantProductValidationError(`Product name must be ${MAX_NAME} characters or fewer.`);
  }

  const description = isBlank(body.description) ? null : String(body.description).trim().slice(0, MAX_TEXT);
  const aiSummary = isBlank(body.aiSummary) ? null : String(body.aiSummary).trim().slice(0, MAX_TEXT);
  const brand = isBlank(body.brand) ? null : String(body.brand).trim().slice(0, 200);

  assertNoInjectionInMerchantText({
    name,
    description,
    aiSummary,
    brand,
    specifications: body.specifications,
    keywords: body.keywords,
    targetAudience: body.targetAudience,
    useCases: body.useCases,
  });

  return {
    name,
    brand,
    description,
    aiSummary,
    price: validatePrice(body.price, { required: true }),
    inventory: validateInventory(body.inventory, { fallback: 0 }),
    category: validateCategory(body.category),
    productType: validateProductType(body.product_type ?? body.productType),
    sku: validateSku(body.sku),
    status: validateStatus(body.status),
    specifications: validateSpecifications(body.specifications) ?? {},
  };
}

/**
 * Validates a partial update payload. Only the keys present are validated and
 * returned, so untouched fields keep their existing values.
 */
export function validateProductUpdate(body = {}) {
  const out = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw new MerchantProductValidationError('Product name cannot be empty.');
    if (name.length > MAX_NAME) {
      throw new MerchantProductValidationError(`Product name must be ${MAX_NAME} characters or fewer.`);
    }
    out.name = name;
  }
  if (body.brand !== undefined) out.brand = String(body.brand).trim().slice(0, 200) || null;
  if (body.description !== undefined) out.description = String(body.description).trim().slice(0, MAX_TEXT) || null;
  if (body.aiSummary !== undefined) out.aiSummary = String(body.aiSummary).trim().slice(0, MAX_TEXT) || null;
  if (body.price !== undefined) out.price = validatePrice(body.price, { required: true });
  if (body.inventory !== undefined) out.inventory = validateInventory(body.inventory, { required: true });
  if (body.category !== undefined) out.category = validateCategory(body.category, { required: false });
  if (body.product_type !== undefined || body.productType !== undefined) {
    out.productType = validateProductType(body.product_type ?? body.productType);
  }
  if (body.sku !== undefined) out.sku = validateSku(body.sku, { required: true });
  if (body.status !== undefined) out.status = validateStatus(body.status);
  if (body.specifications !== undefined) out.specifications = validateSpecifications(body.specifications);

  assertNoInjectionInMerchantText({
    name: out.name,
    description: out.description,
    aiSummary: out.aiSummary,
    brand: out.brand,
    specifications: out.specifications,
    keywords: body.keywords,
    targetAudience: body.targetAudience,
    useCases: body.useCases,
  });

  return out;
}

export default {
  MerchantProductValidationError,
  VALID_CATEGORIES,
  VALID_PRODUCT_TYPES,
  VALID_STATUSES,
  validatePrice,
  validateInventory,
  validateCategory,
  validateProductType,
  validateStatus,
  validateSku,
  validateSpecifications,
  assertNoInjectionInMerchantText,
  validateProductCreate,
  validateProductUpdate,
};
