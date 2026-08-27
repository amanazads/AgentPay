/**
 * Deterministic Natural Language Intent Parser & Constraint Extractor
 * Extracts explicit hard constraints and soft preferences from buyer requests.
 */

const PRODUCT_TYPE_TAXONOMY = {
  power_bank: {
    keywords: ['power bank', 'powerbank', 'portable charger', 'battery pack', 'powercore', 'external battery'],
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
    keywords: ['phone', 'smartphone', 'iphone', 'galaxy', 'pixel', 'android'],
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

  // 1. Identify Target Product Type & Category
  let detectedType = null;
  let detectedCategory = null;

  for (const [typeKey, typeDef] of Object.entries(PRODUCT_TYPE_TAXONOMY)) {
    for (const kw of typeDef.keywords) {
      if (lower.includes(kw)) {
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

  // Brand Match
  for (const b of KNOWN_BRANDS) {
    const escapedBrand = b.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const brandPattern = new RegExp(`(^|[^a-z0-9])${escapedBrand}([^a-z0-9]|$)`, 'i');
    if (brandPattern.test(lower)) {
      hardConstraints.requiredBrand = b;
      break;
    }
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
