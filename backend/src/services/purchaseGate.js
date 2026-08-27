import { query } from '../config/database.js';

export class PurchaseValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PurchaseValidationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Validates a Purchase Candidate independently before any payment or transaction creation.
 * Fails closed if any requirement or security constraint is unmet.
 */
export async function validatePurchaseCandidate(candidate, intent, { userSpendingLimit = Infinity, isLiveMode = false } = {}) {
  if (!candidate || !candidate.id) {
    throw new PurchaseValidationError('INVALID_CANDIDATE', 'No candidate product provided for purchase validation.');
  }

  // 1. Authoritative Database Verification
  const prodRes = await query(`
    SELECT p.*, m.id as merch_id, m.name as merch_name, m.is_verified as merch_verified
    FROM products p
    JOIN merchants m ON p.merchant_id = m.id
    WHERE p.id = $1
  `, [candidate.id]);

  if (prodRes.rows.length === 0) {
    throw new PurchaseValidationError('PRODUCT_NOT_FOUND', `Product ${candidate.id} does not exist in authoritative catalog.`);
  }

  const dbProd = prodRes.rows[0];
  const price = parseFloat(dbProd.price);
  const inventory = parseInt(dbProd.inventory || 0);

  // 2. Merchant Ownership Check
  if (candidate.merchant_id && candidate.merchant_id !== dbProd.merch_id) {
    throw new PurchaseValidationError(
      'MERCHANT_OWNERSHIP_MISMATCH',
      `Product ${candidate.id} does not belong to merchant ${candidate.merchant_id}.`
    );
  }

  // 3. Test Fixture Isolation Check
  if (dbProd.is_test_lab === true || dbProd.commerce_eligible === false) {
    throw new PurchaseValidationError(
      'TEST_FIXTURE_INELIGIBLE',
      `Product '${dbProd.name}' is a test lab fixture and is strictly ineligible for customer commerce.`
    );
  }

  // 4. Stock & Inventory Check
  if (!dbProd.in_stock || inventory <= 0) {
    throw new PurchaseValidationError(
      'OUT_OF_STOCK',
      `Product '${dbProd.name}' is currently out of stock (${inventory} available).`
    );
  }

  // 5. Price Ceiling Validation
  if (intent?.maxPrice !== null && intent?.maxPrice !== undefined && price > intent.maxPrice) {
    throw new PurchaseValidationError(
      'PRICE_LIMIT_EXCEEDED',
      `Product price ₹${price} exceeds user authorized maximum budget of ₹${intent.maxPrice}.`
    );
  }

  if (price > userSpendingLimit) {
    throw new PurchaseValidationError(
      'SPENDING_CEILING_EXCEEDED',
      `Product price ₹${price} exceeds buyer spending limit of ₹${userSpendingLimit}.`
    );
  }

  // 6. Product Type & Specification Match
  if (intent?.productType) {
    const pType = (dbProd.product_type || '').toLowerCase();
    const pName = dbProd.name.toLowerCase();

    let matchesType = false;
    if (intent.productType === 'power_bank') {
      matchesType = pType === 'power_bank' || pName.includes('power bank') || pName.includes('powerbank') || pName.includes('powercore');
    } else if (intent.productType === 'headphones') {
      matchesType = pType === 'headphones' || pName.includes('headphone') || pName.includes('wh-1000xm5') || pName.includes('quietcomfort');
    } else if (intent.productType === 'laptop') {
      matchesType = pType === 'laptop' || pName.includes('laptop') || pName.includes('macbook');
    } else if (intent.productType === 'mouse') {
      matchesType = pType === 'mouse' || pName.includes('mouse');
    } else {
      matchesType = pType === intent.productType || pName.includes(intent.productType);
    }

    if (!matchesType) {
      throw new PurchaseValidationError(
        'PRODUCT_TYPE_MISMATCH',
        `Cannot purchase '${dbProd.name}' (type: ${pType || 'other'}) for request expecting '${intent.productType}'.`
      );
    }
  }

  // 7. Battery Capacity Check
  if (intent?.hardConstraints?.requiredCapacityMah) {
    const reqCap = intent.hardConstraints.requiredCapacityMah;
    const specs = typeof dbProd.specifications === 'object' ? dbProd.specifications : {};
    let actualCap = specs.capacity_mah || null;
    if (!actualCap && specs.capacity) {
      const m = specs.capacity.toString().match(/(\d{4,6})/);
      if (m) actualCap = parseInt(m[1]);
    }
    if (!actualCap) {
      const m = dbProd.name.match(/(\d{4,6})\s*mah/i);
      if (m) actualCap = parseInt(m[1]);
    }

    if (!actualCap || actualCap < reqCap) {
      throw new PurchaseValidationError(
        'SPECIFICATION_UNMET',
        `Product battery capacity (${actualCap ? `${actualCap}mAh` : 'unknown'}) does not meet required >= ${reqCap}mAh.`
      );
    }
  }

  return {
    valid: true,
    product: {
      id: dbProd.id,
      name: dbProd.name,
      brand: dbProd.brand,
      price,
      merchantId: dbProd.merch_id,
      merchantName: dbProd.merch_name,
      inventory,
    },
  };
}
