/**
 * Deterministic Natural Language Intent Parser & Constraint Extractor
 * Extracts explicit hard constraints and soft preferences from buyer requests.
 */

const PRODUCT_TYPE_TAXONOMY = {
  power_bank: {
    keywords: ['power bank', 'powerbank', 'portable charger', 'battery pack', 'powercore', 'external battery'],
    category: 'Electronics',
  },
  charger: {
    keywords: ['charger', 'gan charger', 'wall charger', 'fast charger', 'powerport', 'adapter', 'charging adapter', 'power adapter'],
    category: 'Electronics',
  },
  headphones: {
    keywords: ['headphone', 'headphones', 'earphones', 'earbuds', 'airpods', 'wh-1000xm5', 'quietcomfort', 'accentum', 'headset'],
    category: 'Electronics',
  },
  laptop: {
    keywords: ['laptop', 'notebook', 'macbook', 'macbook pro', 'macbook air', 'thinkpad', 'ultrabook', 'zephyrus', 'tuf gaming', 'xps 15'],
    category: 'Electronics',
  },
  monitor: {
    keywords: ['monitor', 'display', 'screen', 'ultrasharp', 'ultrafine', '4k display', 'curved monitor', 'gaming monitor'],
    category: 'Peripherals',
  },
  mouse: {
    keywords: ['mouse', 'trackpad', 'mx master', 'wireless mouse', 'gaming mouse'],
    category: 'Peripherals',
  },
  keyboard: {
    keywords: ['keyboard', 'keychron', 'mechanical keyboard', 'wireless keyboard', 'qmk'],
    category: 'Peripherals',
  },
  chair: {
    keywords: ['chair', 'ergonomic chair', 'office chair', 'aeron', 'desk chair', 'seating'],
    category: 'Furniture',
  },
  desk: {
    keywords: ['desk', 'standing desk', 'height adjustable desk', 'workstation', 'table'],
    category: 'Furniture',
  },
  smartphone: {
    keywords: ['smartphone', 'smart phone', 'iphone', 'galaxy', 'pixel', 'android phone', 'mobile phone', 'handset', 'phone', 'mobile'],
    category: 'Electronics',
  },
  dock: {
    keywords: ['dock', 'docking station', 'thunderbolt dock', 'usb-c hub', 'caldigit'],
    category: 'Peripherals',
  },
  software: {
    keywords: ['software', 'license', 'subscription', 'jetbrains', 'figma', 'seat'],
    category: 'Software & Licenses',
  },
};

const KNOWN_BRANDS = [
  'Sony', 'Apple', 'Bose', 'Sennheiser', 'ASUS', 'Dell', 'Xiaomi', 'Mi', 'Anker',
  'Ambrane', 'Logitech', 'Keychron', 'Herman Miller', 'Ergoflex', 'Samsung', 'LG',
  'CalDigit', 'Figma', 'JetBrains'
];

export function parseBuyerIntent(queryText) {
  if (!queryText || typeof queryText !== 'string') {
    return {
      rawQuery: '',
      productType: null,
      category: null,
      maxPrice: null,
      minPrice: null,
      quantity: 1,
      hardConstraints: {},
      softPreferences: {},
    };
  }

  const text = queryText.trim();
  const lower = text.toLowerCase();

  // 1. Identify Target Product Type & Category (word boundary check)
  let detectedType = null;
  let detectedCategory = null;

  for (const [typeKey, typeDef] of Object.entries(PRODUCT_TYPE_TAXONOMY)) {
    for (const kw of typeDef.keywords) {
      const kwRegex = new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
      if (kwRegex.test(lower)) {
        detectedType = typeKey;
        detectedCategory = typeDef.category;
        break;
      }
    }
    if (detectedType) break;
  }

  // 2. Extract Price Constraints
  let maxPrice = null;
  let minPrice = null;

  // Patterns for "under ₹5,000", "below 80000", "max 15k", "budget 50000", "under 5,000"
  const maxPriceMatch = lower.match(/(?:under|below|less than|max|up to|budget|within|worth|around|for)\s*(?:₹|rs\.?|inr)?\s*([\d,]+)(?:k)?/i);
  if (maxPriceMatch) {
    let valStr = maxPriceMatch[1].replace(/,/g, '');
    let val = parseFloat(valStr);
    if (lower.includes(`${valStr}k`) || lower.includes(`${maxPriceMatch[1]}k`)) {
      val *= 1000;
    }
    if (!isNaN(val) && val > 0) maxPrice = val;
  }

  // Check standalone currency mentions like "₹5,000" or "Rs 28990"
  if (!maxPrice) {
    const standaloneMatch = lower.match(/(?:₹|rs\.?|inr)\s*([\d,]+)/i);
    if (standaloneMatch) {
      const val = parseFloat(standaloneMatch[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0) maxPrice = val;
    }
  }

  // Check for min price e.g. "above ₹10,000", "at least 5000"
  const minPriceMatch = lower.match(/(?:above|more than|at least|min(?:imum)?)\s*(?:₹|rs\.?|inr)?\s*([\d,]+)/i);
  if (minPriceMatch) {
    const val = parseFloat(minPriceMatch[1].replace(/,/g, ''));
    if (!isNaN(val) && val > 0) minPrice = val;
  }

  // 3. Extract Quantity (e.g. "Order 5 chairs", "buy 2 laptops")
  let quantity = 1;
  const qtyMatch = lower.match(/(?:^|\b(?:order|buy|purchase|get|find)\s+)(\d+)\s+/i);
  if (qtyMatch) {
    const q = parseInt(qtyMatch[1]);
    if (!isNaN(q) && q > 0) quantity = q;
  }

  // 4. Extract Explicit Domain-Specific Hard Constraints
  const hardConstraints = {};

  // Capacity (e.g. "20000mAh", "20,000 mah", "24000 mah")
  const capacityMatch = lower.match(/(\d[\d,]{3,7})\s*(?:mah|milliamp)/i);
  if (capacityMatch) {
    hardConstraints.requiredCapacityMah = parseInt(capacityMatch[1].replace(/,/g, ''));
  }

  // RAM (e.g. "16GB RAM", "32 GB", "64gb")
  const ramMatch = lower.match(/(\d{1,3})\s*(?:gb|gigabytes?)\s*(?:ram|memory)?/i);
  if (ramMatch && (detectedType === 'laptop' || lower.includes('ram') || lower.includes('memory'))) {
    hardConstraints.requiredRamGb = parseInt(ramMatch[1]);
  }

  // Storage (e.g. "512GB SSD", "1TB SSD", "2TB")
  const storageTbMatch = lower.match(/(\d{1,2})\s*(?:tb)\s*(?:ssd|storage|nvme)?/i);
  const storageGbMatch = lower.match(/(\d{3,4})\s*(?:gb)\s*(?:ssd|storage|nvme)/i);
  if (storageTbMatch) {
    hardConstraints.requiredStorageGb = parseInt(storageTbMatch[1]) * 1024;
  } else if (storageGbMatch) {
    hardConstraints.requiredStorageGb = parseInt(storageGbMatch[1]);
  }

  // ANC (Active Noise Cancellation)
  if (/\banc\b/i.test(lower) || lower.includes('noise cancel') || lower.includes('noise-cancelling')) {
    hardConstraints.requiredAnc = true;
  }

  // 4K Resolution
  if (lower.includes('4k') || lower.includes('uhd') || lower.includes('3840')) {
    hardConstraints.requiredResolution = '4K';
  }

  // Wireless / Bluetooth
  if (lower.includes('wireless') || lower.includes('bluetooth')) {
    hardConstraints.requiredWireless = true;
  }

  // Wattage (e.g. "65W", "100W charger", "140W")
  const wattMatch = lower.match(/(\d{2,3})\s*w(?:atts?)?\b/i);
  if (wattMatch) {
    hardConstraints.requiredWattageW = parseInt(wattMatch[1], 10);
  }

  // GaN (Gallium Nitride) technology requirement
  if (/\bgan\b/i.test(lower) || lower.includes('gallium nitride')) {
    hardConstraints.requiredGan = true;
  }

  // Brand Match
  for (const b of KNOWN_BRANDS) {
    const escapedBrand = b.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const brandPattern = new RegExp(`(^|[^a-z0-9])${escapedBrand}([^a-z0-9]|$)`, 'i');
    if (brandPattern.test(lower)) {
      hardConstraints.requiredBrand = b;
      break;
    }
  }

  // Model / Specific Product Terms Extraction
  const modelTerms = extractSpecificModelTerms(text, hardConstraints.requiredBrand);
  if (modelTerms && modelTerms.length > 0) {
    hardConstraints.requiredModelTerms = modelTerms;
    hardConstraints.requiredModelPhrase = modelTerms.join(' ');
  }

  // 5. Soft Preferences
  const softPreferences = {
    fastestDelivery: lower.includes('fast') || lower.includes('express') || lower.includes('tomorrow') || lower.includes('arrive within') || lower.includes('2 days'),
    highRating: lower.includes('best') || lower.includes('top') || lower.includes('highly rated'),
    ergonomic: lower.includes('ergonomic'),
  };

  return {
    rawQuery: text,
    productType: detectedType,
    category: detectedCategory,
    maxPrice,
    minPrice,
    quantity,
    hardConstraints,
    softPreferences,
  };
}

export function extractSpecificModelTerms(queryText, detectedBrand = null) {
  if (!queryText || typeof queryText !== 'string') return null;
  let text = queryText.toLowerCase();

  // 1. Remove price clauses
  text = text.replace(/(?:under|below|less than|budget|max|up to|for|worth|price of|around|within|rupees|rs\.?|inr)?\s*(?:₹|rs\.?|inr|rupees)\s*[\d,]+(?:k)?/gi, ' ');
  text = text.replace(/(?:under|below|less than|budget|max|up to|worth|price of|around|within)\s*[\d,]+(?:k)?/gi, ' ');
  text = text.replace(/\b\d+\s*(?:inr|rs|rupees|bucks)\b/gi, ' ');

  // 2. Remove quantity expressions
  text = text.replace(/(?:order|buy|purchase|get|find|procure)\s+\d+\s+/gi, ' ');
  text = text.replace(/\b\d+\s*(?:units?|items?|pieces?|pcs|each)\b/gi, ' ');

  // 3. Remove known spec patterns
  text = text.replace(/\d[\d,]{3,7}\s*(?:mah|milliamp)\b/gi, ' ');
  text = text.replace(/\d+(?:\.\d+)?\s*w(?:atts?)?\b/gi, ' ');
  text = text.replace(/\d{1,3}\s*(?:gb|tb)\s*(?:ram|ssd|memory|storage|nvme)?\b/gi, ' ');
  text = text.replace(/\b(?:4k|uhd|fhd|qhd|anc|wireless|bluetooth|ergonomic|dpi|hz|gan)\b/gi, ' ');
  text = text.replace(/fast[\s-]charg(?:e|ing)?/gi, ' ');
  text = text.replace(/noise[\s-]cancell?(?:ing|ation)?/gi, ' ');

  // 4. Remove multi-word generic category phrases FIRST before single-word fillers
  const genericCategoryPhrases = [
    'power bank', 'powerbank', 'portable charger', 'battery pack', 'external battery',
    'wall charger', 'fast charger', 'power adapter', 'charging adapter',
    'desk chair', 'office chair', 'standing desk', 'height adjustable desk',
    'docking station', 'usb-c hub', 'thunderbolt dock',
    'noise cancelling', 'noise cancellation', 'smart phone', 'mobile phone'
  ];
  for (const c of genericCategoryPhrases) {
    text = text.replace(new RegExp(`\\b${c}\\b`, 'gi'), ' ');
  }

  // 5. Remove common action, filler words and generic technical descriptors
  const fillers = [
    'buy', 'order', 'purchase', 'get', 'find', 'procure', 'acquire', 'need', 'want',
    'looking', 'search', 'the', 'a', 'an', 'me', 'best', 'top', 'good', 'new', 'latest',
    'with', 'for', 'and', 'or', 'in', 'of', 'to', 'please', 'from', 'any', 'cheap',
    'cheapest', 'affordable', 'our', 'team', 'design', 'software', 'development', 'office',
    'each', 'per', 'unit', 'units', 'item', 'items', 'battery', 'batteries', 'cell', 'cells',
    'charger', 'chargers', 'charging', 'pack', 'packs', 'backup', 'power', 'bank',
    'headphones', 'headphone', 'earphones', 'earbuds', 'headset',
    'laptop', 'notebook', 'ultrabook', 'computer',
    'monitor', 'display', 'screen',
    'mouse', 'trackpad',
    'keyboard',
    'chair', 'chairs', 'seating',
    'desk', 'table', 'workstation',
    'phone', 'phones', 'smartphone', 'smartphones', 'mobile', 'handset',
    'dock', 'hub', 'adapter',
    'enterprise', 'corporate', 'business', 'personal', 'home',
    'device', 'equipment', 'hardware', 'gadget', 'series', 'edition', 'version',
    'inr', 'rs', 'rupees', 'model', 'specs', 'specifications',
    'high', 'quality', 'sound', 'audio', 'ear', 'head', 'noise', 'cancelling', 'cancellation', 'canceling'
  ];
  for (const f of fillers) {
    text = text.replace(new RegExp(`\\b${f}\\b`, 'gi'), ' ');
  }

  // 6. Remove brand if known
  if (detectedBrand) {
    text = text.replace(new RegExp(`\\b${detectedBrand.toLowerCase()}\\b`, 'gi'), ' ');
  }

  const tokens = text
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9-]/g, ''))
    .filter((t) => t.length >= 2 && !fillers.includes(t));

  return tokens.length > 0 ? tokens : null;
}

/**
 * Merges client-supplied structured search filters into a parsed intent.
 *
 * Security / authority model:
 *   - Filters are UNTRUSTED INPUT. They may only ever *narrow* the search, never
 *     widen it, and they can never raise a budget ceiling, grant permissions,
 *     or influence policy, pricing or approval. They are search constraints only.
 *   - Where a natural-language constraint and a structured filter disagree, the
 *     STRICTER of the two wins. This makes the filters fail-safe: a malicious or
 *     careless filter cannot be used to escape a constraint the user typed.
 *   - All values are coerced and bounds-checked server-side. The frontend is not
 *     trusted to have validated anything.
 *
 * @param {object} parsedIntent - Output of parseBuyerIntent()
 * @param {object} [filters] - { maxBudget, brand, delivery }
 * @returns {object} A new intent object with the filters applied
 */
export function applyStructuredFilters(parsedIntent, filters = {}) {
  const intent = {
    ...parsedIntent,
    hardConstraints: { ...(parsedIntent?.hardConstraints || {}) },
    softPreferences: { ...(parsedIntent?.softPreferences || {}) },
  };

  if (!filters || typeof filters !== 'object') return intent;

  const applied = [];

  // --- Max budget: a hard ceiling, and only ever tightened. ---
  const rawBudget = filters.maxBudget ?? filters.max_budget ?? filters.budget;
  if (rawBudget !== undefined && rawBudget !== null && String(rawBudget).trim() !== '') {
    const budget = Number.parseFloat(String(rawBudget).replace(/[^\d.]/g, ''));
    if (Number.isFinite(budget) && budget > 0 && budget <= 100000000) {
      intent.maxPrice = intent.maxPrice === null || intent.maxPrice === undefined
        ? budget
        : Math.min(intent.maxPrice, budget);
      applied.push(`maxBudget=${intent.maxPrice}`);
    }
  }

  // --- Preferred brand: a hard constraint when the request did not name one. ---
  // If the user already named a brand in the request text, the typed request
  // wins; a filter must not silently redirect the search to another brand.
  const rawBrand = filters.brand ?? filters.preferredBrand ?? filters.preferred_brand;
  if (typeof rawBrand === 'string' && rawBrand.trim()) {
    const brand = rawBrand.trim().slice(0, 40).replace(/[^\p{L}\p{N}\s.&'-]/gu, '');
    if (brand && !intent.hardConstraints.requiredBrand) {
      intent.hardConstraints.requiredBrand = brand;
      applied.push(`brand=${brand}`);
    }
  }

  // --- Delivery speed: a ranking preference plus the pricing delivery method. ---
  // Deliberately NOT a hard filter: express shipping availability is a merchant
  // attribute, and treating it as a hard constraint would produce misleading
  // NO_MATCH results. It influences ranking and the quoted delivery fee.
  const rawDelivery = filters.delivery ?? filters.deliverySpeed ?? filters.delivery_speed;
  if (typeof rawDelivery === 'string' && rawDelivery.trim()) {
    const speed = rawDelivery.trim().toLowerCase();
    if (speed === 'fastest' || speed === 'express') {
      intent.softPreferences.fastestDelivery = true;
      intent.deliveryMethod = 'EXPRESS';
      applied.push('delivery=EXPRESS');
    } else if (speed === 'standard') {
      intent.deliveryMethod = 'STANDARD';
      applied.push('delivery=STANDARD');
    }
  }

  if (applied.length > 0) {
    intent.appliedStructuredFilters = applied;
  }

  return intent;
}

/**
 * Merges LLM-proposed intent into the deterministic intent, treating the LLM
 * output strictly as UNTRUSTED DATA.
 *
 * The LLM may improve semantic understanding — recognising a product type or a
 * spec the regex parser missed — but it is never the authority. Concretely it
 * may NOT:
 *   - raise (or remove) a budget ceiling
 *   - change the quantity
 *   - relax or delete any constraint the deterministic parser established
 *   - introduce arbitrary keys that downstream code might act on
 *
 * It may only fill gaps, or tighten an existing numeric bound.
 *
 * @param {object} deterministic - Authoritative output of parseBuyerIntent()
 * @param {object} aiIntent - Untrusted intent proposed by the AI service
 * @returns {object} Merged intent, never weaker than `deterministic`
 */
export function mergeAiIntent(deterministic, aiIntent) {
  const base = {
    ...deterministic,
    hardConstraints: { ...(deterministic?.hardConstraints || {}) },
    softPreferences: { ...(deterministic?.softPreferences || {}) },
  };

  if (!aiIntent || typeof aiIntent !== 'object' || Array.isArray(aiIntent)) return base;

  const rejected = [];

  // productType / category: gap-fill only. Never let the model reclassify a
  // request the deterministic parser already understood — that is how "buy a
  // phone" turns into headphones.
  if (!base.productType && typeof aiIntent.productType === 'string' && aiIntent.productType.trim()) {
    base.productType = aiIntent.productType.trim().slice(0, 40);
  } else if (base.productType && aiIntent.productType && aiIntent.productType !== base.productType) {
    rejected.push('productType');
  }

  if (!base.category && typeof aiIntent.category === 'string' && aiIntent.category.trim()) {
    base.category = aiIntent.category.trim().slice(0, 60);
  } else if (base.category && aiIntent.category && aiIntent.category !== base.category) {
    rejected.push('category');
  }

  // Budget: may only be tightened, never raised or cleared.
  const aiMax = Number.parseFloat(aiIntent.maxPrice);
  if (Number.isFinite(aiMax) && aiMax > 0) {
    if (base.maxPrice === null || base.maxPrice === undefined) {
      base.maxPrice = aiMax;
    } else if (aiMax < base.maxPrice) {
      base.maxPrice = aiMax;
    } else if (aiMax > base.maxPrice) {
      rejected.push('maxPrice');
    }
  } else if (aiIntent.maxPrice !== undefined && base.maxPrice) {
    rejected.push('maxPrice');
  }

  // Min price: may only be raised (tightened).
  const aiMin = Number.parseFloat(aiIntent.minPrice);
  if (Number.isFinite(aiMin) && aiMin > 0) {
    if (base.minPrice === null || base.minPrice === undefined) {
      base.minPrice = aiMin;
    } else if (aiMin > base.minPrice) {
      base.minPrice = aiMin;
    }
  }

  // Quantity is financially material (quantity x unit price). Deterministic only.
  if (aiIntent.quantity !== undefined && Number.parseInt(aiIntent.quantity, 10) !== base.quantity) {
    rejected.push('quantity');
  }

  // Hard constraints: additive only. An existing deterministic constraint is
  // never overwritten or deleted by the model.
  const ALLOWED_CONSTRAINTS = new Set([
    'requiredCapacityMah', 'requiredRamGb', 'requiredStorageGb', 'requiredAnc',
    'requiredResolution', 'requiredWireless', 'requiredWattageW', 'requiredGan',
    'requiredBrand', 'requiredModelTerms', 'requiredModelPhrase',
  ]);
  const aiConstraints = aiIntent.hardConstraints;
  if (aiConstraints && typeof aiConstraints === 'object' && !Array.isArray(aiConstraints)) {
    for (const [key, value] of Object.entries(aiConstraints)) {
      if (!ALLOWED_CONSTRAINTS.has(key)) {
        rejected.push(`hardConstraints.${key}`);
        continue;
      }
      if (base.hardConstraints[key] !== undefined) {
        if (JSON.stringify(base.hardConstraints[key]) !== JSON.stringify(value)) {
          rejected.push(`hardConstraints.${key}`);
        }
        continue;
      }
      base.hardConstraints[key] = value;
    }
  }

  // Soft preferences are ranking hints only, so the model may contribute
  // booleans here — but only known keys, and only as `true`.
  const ALLOWED_PREFERENCES = new Set(['fastestDelivery', 'highRating', 'ergonomic']);
  const aiPrefs = aiIntent.softPreferences;
  if (aiPrefs && typeof aiPrefs === 'object' && !Array.isArray(aiPrefs)) {
    for (const [key, value] of Object.entries(aiPrefs)) {
      if (ALLOWED_PREFERENCES.has(key) && value === true) {
        base.softPreferences[key] = true;
      }
    }
  }

  if (rejected.length > 0) {
    base.rejectedAiFields = rejected;
  }

  return base;
}
