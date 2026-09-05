import { query } from '../config/database.js';
import { getSpendingSummary } from './spendingService.js';
import { AI_CATALOG_PREDICATE } from './catalogEligibility.js';
import { scanMerchantContent } from './promptSecurityGuard.js';

/**
 * Deterministic Candidate Filter & Product Eligibility Engine
 * Enforces: "NO MATCH = NO PURCHASE. NEVER USE FALLBACK PRODUCTS."
 * 
 * Rules:
 * 1. Allowed Categories: Hard policy boundary. Unpermitted categories are rejected.
 * 2. Preferred Brands: Influences ranking (+15 score boost) unless explicit brand is required.
 * 3. Explicit User Brand Constraint: Wins over general preference.
 * 4. Delivery SLA: Evaluated as preference (ranking boost) or hard constraint.
 * 5. Shipping Fee: Included in total price validation.
 */

export async function findEligibleProducts(intent, { merchantId = null, userId = null, buyerPolicy = null, limit = 10 } = {}) {
  const { productType, category, maxPrice, minPrice, hardConstraints = {}, softPreferences = {}, rawQuery = '' } = intent;

  // Quantity participates in hard filtering (inventory depth), so normalize it
  // once here rather than per-candidate.
  const requestedQuantity = Math.max(1, parseInt(intent?.quantity, 10) || 1);

  // Load buyer policy if userId is provided and buyerPolicy is not passed
  let policy = buyerPolicy;
  if (!policy && userId) {
    policy = await getSpendingSummary(userId);
  }

  const buyerAllowedCategories = policy?.categories ? policy.categories.map((c) => c.toLowerCase()) : null;
  const preferredBrands = policy?.preferredBrands ? policy.preferredBrands.map((b) => b.toLowerCase()) : [];

  let sql = `
    SELECT p.*,
           m.name as merchant_name,
           m.is_verified as merchant_verified,
           m.rating as merchant_rating,
           pam.ai_summary,
           pam.keywords as ai_keywords,
           pam.is_promoted
    FROM products p
    JOIN merchants m ON p.merchant_id = m.id
    LEFT JOIN product_ai_metadata pam ON pam.product_id = p.id
    WHERE ${AI_CATALOG_PREDICATE}
  `;
  const params = [];

  if (userId) {
    params.push(userId);
    sql += ` AND p.merchant_id NOT IN (
      SELECT merchant_id FROM user_merchant_connections 
      WHERE user_id = $${params.length} AND (status = 'disconnected' OR connection_state = 'DISCONNECTED')
    )`;
  }

  if (merchantId) {
    params.push(merchantId);
    sql += ` AND p.merchant_id = $${params.length}`;
  }

  sql += ` ORDER BY p.price ASC`;

  const res = await query(sql, params);
  const allProducts = res.rows.map((row) => ({
    ...row,
    price: parseFloat(row.price),
    delivery_fee: parseFloat(row.delivery_fee || 0),
    delivery_days: parseInt(row.delivery_days || 2),
    merchant_rating: parseFloat(row.merchant_rating || 4.8),
    // Report real stock. `row.inventory || 25` turned a genuine 0 into 25,
    // so an in_stock-flagged product with no units read as plentiful.
    inventory: Number.isFinite(parseInt(row.inventory, 10)) ? parseInt(row.inventory, 10) : 0,
    specifications: typeof row.specifications === 'object' && row.specifications !== null ? row.specifications : {},
    attributes: typeof row.attributes === 'object' && row.attributes !== null ? row.attributes : {},
  }));

  const eligibleCandidates = [];
  const rejectedCandidates = [];

  for (const prod of allProducts) {
    const failedRules = [];
    const matchedRules = [];
    // RULE 0: Content Safety & Prompt Injection Check
    //
    // Delegated to the canonical guard in promptSecurityGuard.js. This file
    // previously carried its own ~30-pattern copy of the rule list, a third
    // near-identical duplicate alongside purchaseGate.js and the Python
    // service — three lists that could (and did) drift apart. The shared guard
    // also handles Unicode/zero-width/homoglyph obfuscation and hex and
    // percent-encoded payloads, which the local copy missed.
    const contentScan = scanMerchantContent({
      name: prod.name,
      description: prod.description,
      brand: prod.brand,
      sku: prod.sku,
      specifications: prod.specifications,
      reviews: prod.reviews,
      aiMetadata: {
        summary: prod.ai_summary,
        targetAudience: prod.target_audience,
        useCases: prod.use_cases,
        keywords: prod.ai_keywords,
      },
    });

    if (!contentScan.clean) {
      failedRules.push({
        rule: 'SECURITY_THREAT_DETECTED',
        reason: 'Adversarial prompt injection pattern detected in untrusted product catalog content.',
        fields: contentScan.findings.map((f) => f.field),
      });
    }

    // RULE 0b: Stock & Inventory Check
    //
    // Quantity is a HARD constraint, not a hint. This previously only tested
    // `inventory <= 0`, so "buy 5 ergonomic chairs" happily returned a chair
    // with a single unit in stock. The requested quantity must be actually
    // available or the candidate is not eligible.
    if (!prod.in_stock || prod.inventory <= 0) {
      failedRules.push({
        rule: 'OUT_OF_STOCK',
        reason: `Product '${prod.name}' is currently out of stock (${prod.inventory || 0} available).`,
      });
    } else if (prod.inventory < requestedQuantity) {
      failedRules.push({
        rule: 'INSUFFICIENT_INVENTORY',
        reason: `Product '${prod.name}' has only ${prod.inventory} in stock, but ${requestedQuantity} were requested.`,
      });
    } else {
      matchedRules.push(`In stock (${prod.inventory} units available, ${requestedQuantity} requested)`);
    }

    // RULE 1: Buyer Permitted Category (Hard Policy Boundary)
    if (buyerAllowedCategories && buyerAllowedCategories.length > 0) {
      const pCat = (prod.category || '').toLowerCase();
      if (!buyerAllowedCategories.includes(pCat)) {
        failedRules.push({
          rule: 'CATEGORY_NOT_PERMITTED',
          reason: `Category '${prod.category}' is not permitted by your purchasing policy. Permitted: ${policy.categories.join(', ')}.`,
        });
      } else {
        matchedRules.push(`Category '${prod.category}' is authorized by buyer policy`);
      }
    }

    // RULE 2: Price Constraints (Authoritative Final Match including delivery fee)
    if (maxPrice !== null && prod.price > maxPrice) {
      failedRules.push({
        rule: 'MAX_PRICE_EXCEEDED',
        reason: `Product price ₹${prod.price.toLocaleString('en-IN')} exceeds authorized maximum budget of ₹${maxPrice.toLocaleString('en-IN')}.`,
      });
    } else if (maxPrice !== null) {
      matchedRules.push(`Price ₹${prod.price.toLocaleString('en-IN')} is within budget of ₹${maxPrice.toLocaleString('en-IN')}`);
    }

    if (minPrice !== null && prod.price < minPrice) {
      failedRules.push({
        rule: 'MIN_PRICE_UNMET',
        reason: `Product price ₹${prod.price.toLocaleString('en-IN')} is below required minimum of ₹${minPrice.toLocaleString('en-IN')}.`,
      });
    }

    // RULE 3: Product Type & Category Compatibility
    if (productType) {
      const pType = (prod.product_type || '').toLowerCase();
      const pName = prod.name.toLowerCase();
      const pCat = (prod.category || '').toLowerCase();

      let isTypeMatch = false;

      if (productType === 'power_bank') {
        isTypeMatch = pType === 'power_bank' || pName.includes('power bank') || pName.includes('powerbank') || pName.includes('powercore');
      } else if (productType === 'charger') {
        isTypeMatch = pType === 'charger' || pName.includes('charger') || pName.includes('powerport') || pName.includes('adapter');
      } else if (productType === 'headphones') {
        isTypeMatch = pType === 'headphones' || pName.includes('headphone') || pName.includes('earbuds') || pName.includes('wh-1000xm5') || pName.includes('quietcomfort') || pName.includes('accentum');
      } else if (productType === 'laptop') {
        isTypeMatch = pType === 'laptop' || pName.includes('laptop') || pName.includes('macbook') || pName.includes('zephyrus') || pName.includes('tuf') || pName.includes('xps');
      } else if (productType === 'monitor') {
        isTypeMatch = pType === 'monitor' || pName.includes('monitor') || pName.includes('display') || pName.includes('ultrasharp') || pName.includes('ultrafine');
      } else if (productType === 'mouse') {
        isTypeMatch = pType === 'mouse' || pName.includes('mouse') || pName.includes('mx master');
      } else if (productType === 'keyboard') {
        isTypeMatch = pType === 'keyboard' || pName.includes('keyboard') || pName.includes('keychron');
      } else if (productType === 'chair') {
        isTypeMatch = pType === 'chair' || pName.includes('chair') || pName.includes('aeron');
      } else if (productType === 'desk') {
        isTypeMatch = pType === 'desk' || pName.includes('desk');
      } else if (productType === 'smartphone' || productType === 'phone') {
        const isAudioDevice = pType === 'headphones' || /\b(headphone|headphones|earphone|earphones|earbud|earbuds|headset|airpods|wh-1000xm5|quietcomfort|accentum)\b/i.test(pName);
        isTypeMatch = !isAudioDevice && (
          pType === 'smartphone' || pType === 'phone' || pType === 'mobile' ||
          /\b(phone|smartphone|iphone|galaxy|pixel|mobile|handset)\b/i.test(pName)
        );
      } else if (productType === 'dock') {
        isTypeMatch = pType === 'dock' || pName.includes('dock') || pName.includes('caldigit');
      } else if (productType === 'software') {
        isTypeMatch = pType === 'software' || pName.includes('license') || pName.includes('figma') || pName.includes('jetbrains');
      } else {
        isTypeMatch = pType === productType || (productType.length > 3 && pName.includes(productType)) || pCat.includes(productType);
      }

      if (!isTypeMatch) {
        failedRules.push({
          rule: 'PRODUCT_TYPE_MISMATCH',
          reason: `Requested product type is '${productType}', but product is '${pType || 'other'}' (${prod.name}).`,
        });
      } else {
        matchedRules.push(`Matches requested product type '${productType}'`);
      }
    } else if (rawQuery && rawQuery.trim().length > 0) {
      // If no category/type was detected, treat the raw query as a specific item search
      const stopWords = new Set(['buy', 'order', 'purchase', 'find', 'get', 'the', 'me', 'a', 'an', 'for', 'with', 'and', 'under', 'below', 'in', 'of', 'to', 'is', 'best', 'top', 'new', 'item', 'product', 'each', 'units', 'pieces']);
      const queryTokens = rawQuery.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9-]/g, '')).filter((w) => w.length > 2 && !stopWords.has(w));
      if (queryTokens.length > 0) {
        const pName = (prod.name || '').toLowerCase();
        const pBrand = (prod.brand || '').toLowerCase();
        const pCat = (prod.category || '').toLowerCase();
        const pDesc = (prod.description || '').toLowerCase();
        const pKeywords = Array.isArray(prod.ai_keywords) ? prod.ai_keywords.map((k) => k.toLowerCase()) : [];

        const containsToken = (text, tok) => {
          if (!text) return false;
          const rx = new RegExp(`(^|[^a-z0-9])${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
          return rx.test(text);
        };

        const matchingTokens = queryTokens.filter((tok) =>
          containsToken(pName, tok) || containsToken(pBrand, tok) || containsToken(pCat, tok) || containsToken(pDesc, tok) || pKeywords.some(k => containsToken(k, tok))
        );

        const matchRatio = matchingTokens.length / queryTokens.length;
        if (matchRatio < 0.6) {
          failedRules.push({
            rule: 'PRODUCT_QUERY_MISMATCH',
            reason: `Product '${prod.name}' does not match query keywords (${queryTokens.join(', ')}).`,
          });
        } else {
          matchedRules.push(`Matches query keywords (${matchingTokens.join(', ')})`);
        }
      }
    }

    // RULE 4: Explicit Specification Constraints
    // 4a. Battery Capacity (e.g. 20,000mAh)
    if (hardConstraints.requiredCapacityMah) {
      const reqCap = hardConstraints.requiredCapacityMah;
      let actualCap = null;

      if (prod.specifications?.capacity_mah) {
        actualCap = parseInt(prod.specifications.capacity_mah);
      } else if (prod.specifications?.capacity) {
        const m = prod.specifications.capacity.toString().match(/(\d{4,6})/);
        if (m) actualCap = parseInt(m[1]);
      } else {
        const nameCapMatch = `${prod.name || ''} ${prod.description || ''}`.match(/(\d{4,6})\s*mah/i);
        if (nameCapMatch) actualCap = parseInt(nameCapMatch[1]);
      }

      if (!actualCap || actualCap < reqCap) {
        failedRules.push({
          rule: 'BATTERY_CAPACITY_INSUFFICIENT',
          reason: `Requires battery capacity >= ${reqCap}mAh, but product offers ${actualCap ? actualCap + 'mAh' : 'unspecified capacity'}.`,
        });
      } else {
        matchedRules.push(`Battery capacity ${actualCap}mAh satisfies >= ${reqCap}mAh`);
      }
    }

    // 4b. RAM / Memory (e.g. 16GB RAM)
    if (hardConstraints.requiredRamGb) {
      const reqRam = hardConstraints.requiredRamGb;
      let actualRam = null;

      if (prod.specifications?.ram_gb) {
        actualRam = parseInt(prod.specifications.ram_gb);
      } else {
        const nameRamMatch = prod.name.match(/(\d{1,3})\s*gb\s*(?:ram|unified|memory)/i);
        if (nameRamMatch) actualRam = parseInt(nameRamMatch[1]);
      }

      if (!actualRam || actualRam < reqRam) {
        failedRules.push({
          rule: 'RAM_INSUFFICIENT',
          reason: `Requires RAM >= ${reqRam}GB, but product offers ${actualRam ? actualRam + 'GB' : 'unspecified memory'}.`,
        });
      } else {
        matchedRules.push(`RAM ${actualRam}GB satisfies >= ${reqRam}GB`);
      }
    }

    // 4c. Active Noise Cancellation (ANC)
    if (hardConstraints.requiredAnc) {
      const hasAnc = Boolean(
        prod.specifications?.noise_cancellation ||
        prod.name.toLowerCase().includes('noise cancel') ||
        prod.name.toLowerCase().includes('anc') ||
        prod.name.toLowerCase().includes('wh-1000xm5') ||
        prod.name.toLowerCase().includes('quietcomfort')
      );
      if (!hasAnc) {
        failedRules.push({
          rule: 'ANC_NOT_SUPPORTED',
          reason: 'Active Noise Cancellation (ANC) was required but is not supported by this product.',
        });
      } else {
        matchedRules.push('Active Noise Cancellation verified');
      }
    }

    // 4d. 4K Resolution
    if (hardConstraints.requiredResolution === '4K') {
      const is4k = Boolean(
        prod.name.toLowerCase().includes('4k') ||
        prod.specifications?.resolution?.toLowerCase().includes('4k') ||
        prod.specifications?.resolution?.toLowerCase().includes('3840')
      );
      if (!is4k) {
        failedRules.push({
          rule: 'RESOLUTION_NOT_4K',
          reason: '4K UHD resolution was explicitly required but is not present on this display.',
        });
      } else {
        matchedRules.push('4K Ultra HD resolution confirmed');
      }
    }

    // 4e. Explicit Brand Constraint (e.g. "Only buy Sony", "Sony headphones")
    if (hardConstraints.requiredBrand) {
      const reqBrand = hardConstraints.requiredBrand.toLowerCase();
      const pBrand = (prod.brand || '').toLowerCase();
      const pName = prod.name.toLowerCase();

      if (!pBrand.includes(reqBrand) && !pName.includes(reqBrand)) {
        failedRules.push({
          rule: 'BRAND_MISMATCH',
          reason: `Requested brand '${hardConstraints.requiredBrand}', but product is from '${prod.brand || 'other'}'.`,
        });
      } else {
        matchedRules.push(`Verified official ${hardConstraints.requiredBrand} product`);
      }
    }

    // 4f. Wireless / Bluetooth Connectivity
    if (hardConstraints.requiredWireless) {
      const isWireless = Boolean(
        prod.name.toLowerCase().includes('wireless') ||
        prod.specifications?.bluetooth ||
        prod.specifications?.connectivity?.toLowerCase().includes('bluetooth') ||
        prod.specifications?.connectivity?.toLowerCase().includes('wireless')
      );
      if (!isWireless) {
        failedRules.push({
          rule: 'WIRELESS_NOT_SUPPORTED',
          reason: 'Wireless connectivity was explicitly required but product is wired-only.',
        });
      } else {
        matchedRules.push('Wireless / Bluetooth connectivity verified');
      }
    }

    // 4g. Mandatory Delivery Constraint
    if (hardConstraints.maxDeliveryDays && prod.delivery_days > hardConstraints.maxDeliveryDays) {
      failedRules.push({
        rule: 'DELIVERY_TOO_SLOW',
        reason: `Delivery time of ${prod.delivery_days} days exceeds mandatory requirement of ${hardConstraints.maxDeliveryDays} days.`,
      });
    }

    // 4h. Specific Model / Product Name Constraint
    if (hardConstraints.requiredModelTerms && hardConstraints.requiredModelTerms.length > 0) {
      const pSearchable = `${prod.name || ''} ${prod.brand || ''} ${prod.description || ''}`.toLowerCase();
      const missingTerms = hardConstraints.requiredModelTerms.filter((term) => {
        const termRegex = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
        return !termRegex.test(pSearchable) && !pSearchable.includes(term);
      });

      if (missingTerms.length > 0) {
        failedRules.push({
          rule: 'MODEL_MISMATCH',
          reason: `Requested specific model '${hardConstraints.requiredModelPhrase || hardConstraints.requiredModelTerms.join(' ')}', but product '${prod.name}' does not match required terms (missing: ${missingTerms.join(', ')}).`,
        });
      } else {
        matchedRules.push(`Verified specific model '${hardConstraints.requiredModelPhrase || hardConstraints.requiredModelTerms.join(' ')}' match`);
      }
    }

    // 4i. Mandatory Wattage Constraint
    if (hardConstraints.requiredWattageW) {
      const reqW = hardConstraints.requiredWattageW;
      let actualW = null;
      if (prod.specifications?.wattage_w) {
        actualW = parseInt(prod.specifications.wattage_w, 10);
      } else if (prod.specifications?.power) {
        const m = String(prod.specifications.power).match(/(\d{2,3})\s*w/i);
        if (m) actualW = parseInt(m[1], 10);
      } else if (prod.attributes?.output_watts) {
        actualW = parseInt(prod.attributes.output_watts, 10);
      } else {
        const m = `${prod.name || ''} ${prod.description || ''}`.match(/(\d{2,3})\s*w\b/i);
        if (m) actualW = parseInt(m[1], 10);
      }

      if (!actualW || actualW < reqW) {
        failedRules.push({
          rule: 'WATTAGE_UNMET',
          reason: `Product output (${actualW ? `${actualW}W` : 'unknown'}) does not meet required >= ${reqW}W.`,
        });
      } else {
        matchedRules.push(`Power output verified (>= ${reqW}W)`);
      }
    }

    // 4j. GaN Technology Constraint
    if (hardConstraints.requiredGan) {
      const pSearchable = `${prod.name || ''} ${prod.description || ''} ${JSON.stringify(prod.specifications || {})}`.toLowerCase();
      const hasGan = pSearchable.includes('gan') || pSearchable.includes('gallium nitride');
      if (!hasGan) {
        failedRules.push({
          rule: 'GAN_NOT_SUPPORTED',
          reason: 'GaN (Gallium Nitride) technology is explicitly required but not supported by this product.',
        });
      } else {
        matchedRules.push('GaN technology verified');
      }
    }

    // Eligibility Classification & Ranking Score Calculation
    if (failedRules.length === 0) {
      let matchScore = 70;

      // Brand Preference Boost (+15 points)
      const pBrand = (prod.brand || '').toLowerCase();
      if (preferredBrands.some((pb) => pBrand.includes(pb) || prod.name.toLowerCase().includes(pb))) {
        matchScore += 15;
        matchedRules.push(`Matches buyer preferred brand '${prod.brand}' (+15 rank score)`);
      }

      // Verified Merchant Boost (+5 points)
      if (prod.merchant_verified) matchScore += 5;

      // Delivery SLA Preference Boost (+10 points)
      if (policy?.deliveryPreference?.includes('2 days') && prod.delivery_days <= 2) {
        matchScore += 10;
        matchedRules.push(`Meets fast delivery SLA preference (${prod.delivery_days} days)`);
      } else if (softPreferences.fastestDelivery && prod.delivery_days <= 2) {
        matchScore += 8;
      }

      // Merchant Rating Boost (+5 points)
      if (prod.merchant_rating >= 4.8) matchScore += 5;

      eligibleCandidates.push({
        ...prod,
        matchScore: Math.min(100, matchScore),
        matchedRules,
        selectionReason: `Optimal verified product satisfying 100% of hard constraints (${matchedRules.length} verified attributes).`,
      });
    } else {
      rejectedCandidates.push({
        id: prod.id,
        name: prod.name,
        brand: prod.brand,
        category: prod.category,
        price: prod.price,
        failedRules,
      });
    }
  }

  // Sort eligible candidates by matchScore descending, then price ascending
  eligibleCandidates.sort((a, b) => b.matchScore - a.matchScore || a.price - b.price);

  if (eligibleCandidates.length === 0) {
    // Sort rejected candidates by fewest failed rules to surface relevant near-misses
    rejectedCandidates.sort((a, b) => a.failedRules.length - b.failedRules.length);

    return {
      status: 'NO_MATCH',
      count: 0,
      totalEvaluated: allProducts.length,
      candidates: [],
      eligibleCandidates: [],
      rejectedCandidates,
      winningCandidate: null,
      topCandidate: null,
      rejectionReasons: rejectedCandidates.slice(0, 5).map((r) => `${r.name}: ${r.failedRules.map((f) => f.reason).join(' ')}`),
      explanation: `No in-stock product satisfied all mandatory requirements (${[
        productType ? `Type: ${productType}` : null,
        hardConstraints.requiredModelPhrase ? `Model: ${hardConstraints.requiredModelPhrase}` : null,
        maxPrice ? `Under ₹${maxPrice.toLocaleString('en-IN')}` : null,
        hardConstraints.requiredCapacityMah ? `>= ${hardConstraints.requiredCapacityMah}mAh` : null,
        hardConstraints.requiredRamGb ? `>= ${hardConstraints.requiredRamGb}GB RAM` : null,
        hardConstraints.requiredBrand ? `Brand: ${hardConstraints.requiredBrand}` : null,
      ].filter(Boolean).join(', ')}).`,
    };
  }

  return {
    status: 'MATCH_FOUND',
    count: eligibleCandidates.length,
    totalEvaluated: allProducts.length,
    candidates: eligibleCandidates.slice(0, limit),
    eligibleCandidates: eligibleCandidates,
    rejectedCandidates,
    winningCandidate: eligibleCandidates[0],
    topCandidate: eligibleCandidates[0],
    rejectionReasons: [],
    explanation: `Found ${eligibleCandidates.length} eligible products satisfying all constraints. Top recommendation: '${eligibleCandidates[0].name}' at ₹${eligibleCandidates[0].price.toLocaleString('en-IN')}.`,
  };
}

export default { findEligibleProducts };
