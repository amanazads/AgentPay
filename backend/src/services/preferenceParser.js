/**
 * Natural Language Preference Interpreter & Rule Structurer for AgentPay
 * Converts plain English natural language rules into structured policy matrices.
 */

const KNOWN_CATEGORIES = [
  'Electronics',
  'Peripherals',
  'Software & Licenses',
  'Office Supplies',
  'Furniture',
];

const KNOWN_BRANDS = [
  'Apple',
  'Sony',
  'Logitech',
  'ASUS',
  'Dell',
  'Lenovo',
  'HP',
  'BenQ',
  'Samsung',
  'Anker',
  'Ambrane',
  'Keychron',
  'Bose',
  'Sennheiser',
  'Herman Miller',
  'Ergoflex',
];

export function parseNaturalLanguagePreference(sentence) {
  if (!sentence || typeof sentence !== 'string') {
    return {
      rawSentence: '',
      structured: {},
      summary: 'No rule provided',
      categoryRules: {},
      deliveryRules: {},
      brandRules: {},
    };
  }

  const text = sentence.trim();
  const lower = text.toLowerCase();
  const structured = {};
  const categoryRules = {};
  const deliveryRules = {};
  const brandRules = { preferred: [], required: [] };
  const summaryItems = [];

  // 1. Parse Category-specific Spending Limits
  // e.g. "Never spend more than ₹10,000 on electronics", "Max 15k for peripherals", "spend up to 20000 on office supplies"
  for (const cat of KNOWN_CATEGORIES) {
    const catLower = cat.toLowerCase();
    if (lower.includes(catLower)) {
      // Look for spend pattern in sentence
      const catCapRegex = new RegExp(`(?:never spend more than|under|max|budget of|less than|up to|limit of|cap of)\\s*(?:₹|rs\\.?|inr)?\\s*([\\d,]+)(?:k)?.*(?:${catLower})|(?:${catLower}).*(?:never spend more than|under|max|budget of|less than|up to|limit of|cap of)\\s*(?:₹|rs\\.?|inr)?\\s*([\\d,]+)(?:k)?`, 'i');
      const match = lower.match(catCapRegex);
      if (match) {
        const valStr = (match[1] || match[2] || '').replace(/,/g, '');
        let val = parseFloat(valStr);
        if (lower.includes(`${valStr}k`)) val *= 1000;
        if (!isNaN(val) && val > 0) {
          categoryRules[cat] = {
            maxAmount: val,
            isHardConstraint: true,
          };
          summaryItems.push(`${cat} max limit: ₹${val.toLocaleString('en-IN')} (Hard constraint)`);
        }
      }

      // Look for category approval requirement
      // e.g. "Always ask me before buying furniture", "Require approval for furniture", "Confirm before purchasing furniture"
      if (
        lower.includes('ask') ||
        lower.includes('approval') ||
        lower.includes('confirm') ||
        lower.includes('review')
      ) {
        if (!categoryRules[cat]) categoryRules[cat] = {};
        categoryRules[cat].requireApproval = true;
        summaryItems.push(`Category ${cat}: Human approval required`);
      }
    }
  }

  // 2. Parse Global Spending Limits & Budgets
  // e.g. "Set my autonomous limit to ₹45,000", "Autonomous limit 50k", "Monthly budget 2,00,000"
  const monthlyMatch = lower.match(/(?:monthly budget|monthly spending budget|monthly cap|monthly limit)\s*(?:of|is|to)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+)(?:k|lakhs?|l)?/i);
  if (monthlyMatch) {
    let val = parseFloat(monthlyMatch[1].replace(/,/g, ''));
    if (lower.includes('lakh') || lower.includes('l')) val *= 100000;
    else if (lower.includes('k') && val < 1000) val *= 1000;
    structured.monthlyBudget = val;
    summaryItems.push(`Monthly budget: ₹${val.toLocaleString('en-IN')}`);
  }

  const autoLimitMatch = lower.match(/(?:autonomous limit|single-purchase limit|auto limit|single purchase limit|auto purchase limit)\s*(?:of|is|to)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+)(?:k)?/i);
  if (autoLimitMatch) {
    let val = parseFloat(autoLimitMatch[1].replace(/,/g, ''));
    if (lower.includes('k') && val < 1000) val *= 1000;
    structured.automaticPurchaseLimit = val;
    summaryItems.push(`Autonomous single-purchase limit: ₹${val.toLocaleString('en-IN')}`);
  } else if (!Object.keys(categoryRules).length) {
    // Generic fallback max limit check
    const genericLimitMatch = lower.match(/(?:never spend more than|under|max|budget of|less than|up to|limit of)\s*(?:₹|rs\.?|inr)?\s*([\d,]+)(?:k)?/i);
    if (genericLimitMatch && !monthlyMatch) {
      let val = parseFloat(genericLimitMatch[1].replace(/,/g, ''));
      if (lower.includes('k') && val < 1000) val *= 1000;
      structured.automaticPurchaseLimit = val;
      summaryItems.push(`Autonomous spending limit: ₹${val.toLocaleString('en-IN')}`);
    }
  }

  // 3. Parse Brand Preferences vs Required Brand Rules
  // e.g. "Prefer Sony and Logitech", "Only buy Sony", "Always choose Apple"
  const preferredBrands = [];
  const requiredBrands = [];

  for (const b of KNOWN_BRANDS) {
    const bLower = b.toLowerCase();
    if (lower.includes(bLower)) {
      if (lower.includes(`only buy ${bLower}`) || lower.includes(`must be ${bLower}`) || lower.includes(`only ${bLower}`)) {
        requiredBrands.push(b);
        summaryItems.push(`Required brand: ${b} (Hard constraint)`);
      } else {
        preferredBrands.push(b);
        summaryItems.push(`Preferred brand: ${b} (Ranking preference)`);
      }
    }
  }

  if (preferredBrands.length > 0) {
    structured.preferredBrands = preferredBrands;
    brandRules.preferred = preferredBrands;
  }
  if (requiredBrands.length > 0) {
    brandRules.required = requiredBrands;
  }

  // 4. Parse Delivery SLA Rules
  // e.g. "Only buy products that arrive within 2 days", "Prefer fastest delivery within 2 days", "Delivery within 2 days"
  const deliveryMatch = lower.match(/(?:arrive within|deliver(?:y)? within|within|in)\s*(\d+)\s*(?:days?|business days?)/i);
  if (deliveryMatch) {
    const days = parseInt(deliveryMatch[1]);
    const isHard = lower.includes('only') || lower.includes('must') || lower.includes('strictly');
    deliveryRules.maxDays = days;
    deliveryRules.isHardConstraint = isHard;
    structured.deliveryPreference = days <= 2 ? 'Fastest available (within 2 days)' : 'Standard delivery (3-5 days)';
    summaryItems.push(`Delivery SLA: Max ${days} days (${isHard ? 'Hard constraint' : 'Preference'})`);
  } else if (lower.includes('fastest') || lower.includes('overnight') || lower.includes('next day')) {
    structured.deliveryPreference = 'Fastest available (within 2 days)';
    deliveryRules.maxDays = 2;
    deliveryRules.isHardConstraint = lower.includes('must') || lower.includes('only');
    summaryItems.push(`Delivery SLA: Fastest available (within 2 days)`);
  } else if (lower.includes('lowest shipping') || lower.includes('cheapest shipping') || lower.includes('free shipping')) {
    structured.deliveryPreference = 'Lowest shipping cost';
    summaryItems.push('Delivery SLA: Lowest shipping cost preference');
  }

  // 5. Parse Procurement Behavior (Autonomous vs Always Ask)
  // e.g. "Always require human review", "Always ask me before buying", "Autonomous execution"
  if (
    lower.includes('always require human review') ||
    lower.includes('always ask me') ||
    lower.includes('always review before payment') ||
    lower.includes('never buy without asking') ||
    lower.includes('ask before every purchase')
  ) {
    structured.purchaseBehavior = 'always_ask';
    summaryItems.push('Procurement behavior: Always require human review before payment');
  } else if (lower.includes('autonomous') || lower.includes('auto within limit')) {
    structured.purchaseBehavior = 'auto_within_limit';
    summaryItems.push('Procurement behavior: Autonomous execution within spending limit');
  }

  // 6. Parse Allowed / Blocked Categories
  const mentionedCategories = KNOWN_CATEGORIES.filter((c) => lower.includes(c.toLowerCase()));
  if (mentionedCategories.length > 0 && (lower.includes('only permit') || lower.includes('only allow') || lower.includes('permitted categories'))) {
    structured.categories = mentionedCategories;
    summaryItems.push(`Permitted categories: ${mentionedCategories.join(', ')}`);
  }

  return {
    rawSentence: text,
    structured,
    categoryRules,
    deliveryRules,
    brandRules,
    summary: summaryItems.join(' • ') || 'Saved natural purchasing preference',
    summaryItems,
  };
}

export default {
  parseNaturalLanguagePreference,
};
