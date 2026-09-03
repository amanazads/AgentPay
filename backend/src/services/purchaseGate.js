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

  // 3b. Catalog Active Status Check
  if (dbProd.status === 'ARCHIVED' || dbProd.status === 'PAUSED') {
    throw new PurchaseValidationError(
      'PRODUCT_INACTIVE',
      `Product '${dbProd.name}' is currently ${dbProd.status.toLowerCase()} and cannot be purchased.`
    );
  }

  // 3c. Content Threat & Prompt Injection Check
  const textParts = [
    dbProd.name || '',
    dbProd.description || '',
    typeof dbProd.specifications === 'object' ? JSON.stringify(dbProd.specifications) : (dbProd.specifications || ''),
    dbProd.reviews ? JSON.stringify(dbProd.reviews) : '',
  ];
  const textToCheck = textParts.filter(Boolean).join(' ').toLowerCase();
  const promptInjectionRegexes = [
    /(?:ignore|disregard|forget|override|cancel|bypass)\s+(?:all\s+)?(?:(?:previous|prior|existing|above|system|developer|policy|spending|buyer'?s?|user'?s?)\s+)?(?:the\s+)?(?:rules|instructions|prompts|commands|constraints|limits|policies|policy|budget|guidelines)/i,
    /(?:new\s+instructions?|system\s+override|priority\s+override|jailbreak|developer\s+mode|god\s+mode)/i,
    /\[(?:SYSTEM|DEVELOPER|ADMIN|ROOT|ASSISTANT|INSTRUCTION)\]/i,
    /<\|im_start\|>(?:system|developer|admin)?/i,
    /<<SYS>>|<SYS>|<\/SYS>|<<\/SYS>>/i,
    /-{2,}\s*BEGIN\s+(?:SYSTEM|ADMIN|DEVELOPER)\s+(?:MESSAGE|INSTRUCTION)\s*-{2,}/i,
    /###\s*(?:System|Developer|Admin|Instruction):/i,
    /(?:system\s*:\s*you\s+are|developer\s*:\s*instruction|admin\s*:\s*execute)/i,
    /(?:admin\s+(?:command|mode|privilege|override)|sudo\s+(?:approve|authorize|execute|buy|grant)|grant\s+(?:admin|root|permission|authorization)|root\s+(?:access|privilege))/i,
    /(?:set_approval\s*=\s*(?:auto|true|allow|bypass)|auto_approve\s*=\s*true|force_approve\s*=\s*true)/i,
    /(?:override|bypass|ignore)\s+(?:policy|policies|rules?)\s+(?:and\s+)?(?:approve|allow|authorize|grant)/i,
    /(?:approve|authorize|allow)\s+(?:this\s+)?(?:transaction|order|purchase|intent)\s*(?:automatically|without\s+checks?|now)?/i,
    /priority\s+executive\s+(?:order|approval|override)/i,
    /transfer\s+funds/i,
    /bypass\s+(?:spending|budget|purchasing)\s*(?:limits?|polic(?:y|ies)|rules?)?/i,
    /override\s+(?:spending|budget|limits?)/i,
    /(?:set\s+limit\s*(?:to|=)\s*(?:unlimited|\d{7,})|no\s+spending\s+limit)/i,
    /max_budget\s*=\s*(?:unlimited|[\d,]{7,})/i,
    /(?:ignore|disregard|override)\s+(?:the\s+)?(?:buyer'?s?|user'?s?)?\s*budget/i,
    /(?:set|increase|override|change)\s+quantity\s*(?:to|=)\s*\d+/i,
    /(?:buy|order|purchase|get)\s+\d{2,}\s+(?:units|items|pcs|pieces|laptops|phones|chairs)/i,
    /(?:use|set|charge|pay|enter)\s+(?:₹|rs\.?|inr)?\s*\d+(?:\.\d+)?\s+(?:instead|as\s+price|rather\s+than)\b/i,
    /(?:use|pay|charge|set)\s+.*?instead\s+of\s+(?:the\s+)?(?:real|actual|catalog|official|original)\s+price/i,
    /(?:fake|spoofed|manipulated|override|discounted)\s+price\s*(?:to|=|\:)?\s*(?:₹|rs\.?|inr)?\s*\d+/i,
    /price\s*=\s*(?:₹|rs\.?|inr)?\s*0(?:\.00)?\b/i,
    /(?:reveal|show|display|print|output|leak|disclose|expose|tell\s+me|repeat|what\s+are)\s+(?:the\s+)?(?:system|developer|hidden|internal|initial|agent)?\s*(?:instructions?|prompts?|rules?|guidelines?|config|context|secrets?)/i,
    /(?:what\s+is\s+your\s+(?:system\s+prompt|prompt|instructions?))/i,
    /(?:ignore|bypass|override|disregard)\s+(?:all\s+)?(?:inventory|stock|quantity|out\s+of\s+stock)\s*(?:restrictions?|limits?|checks?|rules?)?/i,
    /(?:force_in_stock|infinite_stock|bypass_inventory)\s*=\s*true/i,
  ];

  if (promptInjectionRegexes.some((rx) => rx.test(textToCheck))) {
    throw new PurchaseValidationError(
      'SECURITY_THREAT_DETECTED',
      'Adversarial prompt injection pattern detected in untrusted product catalog content.'
    );
  }

  // 4. Stock & Inventory Check
  const requestedQty = Math.max(1, parseInt(intent?.quantity || candidate.quantity || 1, 10));
  if (!dbProd.in_stock || inventory <= 0) {
    throw new PurchaseValidationError(
      'OUT_OF_STOCK',
      `Product '${dbProd.name}' is currently out of stock (${inventory} available).`
    );
  }
  if (inventory < requestedQty) {
    throw new PurchaseValidationError(
      'INSUFFICIENT_INVENTORY',
      `Insufficient inventory for product '${dbProd.name}' (${inventory} available, ${requestedQty} requested).`
    );
  }

  // 4b. Anti-Fabrication Attribute Verification
  if (candidate.name) {
    const cleanCandName = candidate.name.replace(/^\d+x\s+/i, '').trim().toLowerCase();
    const cleanDbName = dbProd.name.trim().toLowerCase();
    if (cleanCandName !== cleanDbName && !cleanDbName.includes(cleanCandName) && !cleanCandName.includes(cleanDbName)) {
      throw new PurchaseValidationError(
        'FABRICATED_PRODUCT_NAME',
        `Proposed product name '${candidate.name}' does not match authoritative catalog name '${dbProd.name}'.`
      );
    }
  }

  if (candidate.unit_price !== undefined || (candidate.price !== undefined && (!intent?.quantity || intent.quantity === 1))) {
    const proposedPrice = parseFloat(candidate.unit_price ?? candidate.price);
    if (!isNaN(proposedPrice) && Math.abs(proposedPrice - price) > 0.01 && !candidate.quote_id) {
      throw new PurchaseValidationError(
        'FABRICATED_PRICE',
        `Proposed price (₹${proposedPrice}) diverges from authoritative catalog price (₹${price}).`
      );
    }
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
    } else if (intent.productType === 'charger') {
      matchesType = pType === 'charger' || pName.includes('charger') || pName.includes('powerport') || pName.includes('adapter');
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

  // 8. Wattage Constraint
  if (intent?.hardConstraints?.requiredWattageW) {
    const reqW = intent.hardConstraints.requiredWattageW;
    const specs = typeof dbProd.specifications === 'object' ? dbProd.specifications : {};
    let actualW = null;
    if (specs.wattage_w) actualW = parseInt(specs.wattage_w, 10);
    else if (specs.power) {
      const m = String(specs.power).match(/(\d{2,3})\s*w/i);
      if (m) actualW = parseInt(m[1], 10);
    } else if (dbProd.attributes?.output_watts) {
      actualW = parseInt(dbProd.attributes.output_watts, 10);
    } else {
      const m = `${dbProd.name || ''} ${dbProd.description || ''}`.match(/(\d{2,3})\s*w\b/i);
      if (m) actualW = parseInt(m[1], 10);
    }

    if (!actualW || actualW < reqW) {
      throw new PurchaseValidationError(
        'SPECIFICATION_UNMET',
        `Product wattage (${actualW ? `${actualW}W` : 'unknown'}) does not meet required >= ${reqW}W.`
      );
    }
  }

  // 9. GaN Technology Constraint
  if (intent?.hardConstraints?.requiredGan) {
    const pSearchable = `${dbProd.name || ''} ${dbProd.description || ''} ${JSON.stringify(dbProd.specifications || {})}`.toLowerCase();
    const hasGan = pSearchable.includes('gan') || pSearchable.includes('gallium nitride');
    if (!hasGan) {
      throw new PurchaseValidationError(
        'SPECIFICATION_UNMET',
        'GaN (Gallium Nitride) technology is explicitly required but not supported by this product.'
      );
    }
  }

  // 10. Specific Model / Identifier Check
  if (intent?.hardConstraints?.requiredModelTerms && intent.hardConstraints.requiredModelTerms.length > 0) {
    const pSearchable = `${dbProd.name || ''} ${dbProd.brand || ''} ${dbProd.description || ''}`.toLowerCase();
    const missingTerms = intent.hardConstraints.requiredModelTerms.filter((term) => {
      const termRegex = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
      return !termRegex.test(pSearchable) && !pSearchable.includes(term);
    });

    if (missingTerms.length > 0) {
      throw new PurchaseValidationError(
        'MODEL_MISMATCH',
        `Product '${dbProd.name}' does not match requested model '${intent.hardConstraints.requiredModelPhrase || intent.hardConstraints.requiredModelTerms.join(' ')}' (missing: ${missingTerms.join(', ')}).`
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
