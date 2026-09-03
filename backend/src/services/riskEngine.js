import { query } from '../config/database.js';

/**
 * Explainable Risk Engine for AgentPay
 * Computes an explainable 0-100 risk score based on 5 weighted dimensions.
 */
export async function assessRisk({
  agentId,
  productId,
  merchantId,
  amount,
  quantity = 1,
  product: passedProduct = null,
  merchant: passedMerchant = null,
}) {
  const factors = [];

  // Fetch product & merchant
  let product = passedProduct;
  if (!product && productId) {
    const productRes = await query(`
      SELECT p.*, m.name as merchant_name, m.is_verified, m.risk_level as merchant_risk_level, m.rating
      FROM products p
      JOIN merchants m ON p.merchant_id = m.id
      WHERE p.id = $1
    `, [productId]);
    product = productRes.rows[0] || {};
  } else if (!product) {
    product = {};
  }

  const requestedTotal = parseFloat(amount || 0);

  // -------------------------------------------------------------
  // Factor 1: Merchant Credibility (Weight: 25%)
  // -------------------------------------------------------------
  let merchantScore = 10;
  let merchantReason = 'Verified merchant with established low-risk profile.';

  const isVerified = passedMerchant ? passedMerchant.is_verified : product.is_verified;
  const merchantRiskLevel = passedMerchant ? passedMerchant.risk_level : product.merchant_risk_level;

  if (merchantRiskLevel === 'high' || !isVerified) {
    merchantScore = 90;
    merchantReason = 'Unverified or high-risk flagged merchant.';
  } else if (merchantRiskLevel === 'medium') {
    merchantScore = 45;
    merchantReason = 'Merchant has moderate risk classification or mixed ratings.';
  }

  factors.push({
    name: 'Merchant Credibility',
    score: merchantScore,
    weight: 0.25,
    contribution: Math.round(merchantScore * 0.25),
    explanation: merchantReason,
  });

  // -------------------------------------------------------------
  // Factor 2: Product & Content Threat Detection (Weight: 25%)
  // -------------------------------------------------------------
  let threatScore = 5;
  let threatReason = 'Product description contains standard catalog content.';
  
  const textParts = [
    product.name || '',
    product.description || '',
    typeof product.specifications === 'object' ? JSON.stringify(product.specifications) : (product.specifications || ''),
    product.reviews ? JSON.stringify(product.reviews) : '',
    product.ai_summary || '',
    product.target_audience || '',
    product.use_cases ? JSON.stringify(product.use_cases) : '',
    product.keywords ? JSON.stringify(product.keywords) : '',
  ];
  const originalText = textParts.filter(Boolean).join(' ');
  const textToCheck = originalText.toLowerCase();
  
  const injectionRegexes = [
    // 1. Instruction Overrides, Jailbreaks & Role Escalation
    /(?:ignore|disregard|forget|override|cancel|bypass)\s+(?:all\s+)?(?:(?:previous|prior|existing|above|system|developer|policy|spending|buyer'?s?|user'?s?)\s+)?(?:the\s+)?(?:rules|instructions|prompts|commands|constraints|limits|policies|policy|budget|guidelines)/i,
    /(?:new\s+instructions?|system\s+override|priority\s+override|jailbreak|developer\s+mode|god\s+mode)/i,
    /\[(?:SYSTEM|DEVELOPER|ADMIN|ROOT|ASSISTANT|INSTRUCTION)\]/i,
    /<\|im_start\|>(?:system|developer|admin)?/i,
    /<<SYS>>|<SYS>|<\/SYS>|<<\/SYS>>/i,
    /-{2,}\s*BEGIN\s+(?:SYSTEM|ADMIN|DEVELOPER)\s+(?:MESSAGE|INSTRUCTION)\s*-{2,}/i,
    /###\s*(?:System|Developer|Admin|Instruction):/i,
    /(?:system\s*:\s*you\s+are|developer\s*:\s*instruction|admin\s*:\s*execute)/i,

    // 2. Fake Admin Commands, Approvals & Policy Overrides
    /(?:admin\s+(?:command|mode|privilege|override)|sudo\s+(?:approve|authorize|execute|buy|grant)|grant\s+(?:admin|root|permission|authorization)|root\s+(?:access|privilege))/i,
    /(?:set_approval\s*=\s*(?:auto|true|allow|bypass)|auto_approve\s*=\s*true|force_approve\s*=\s*true)/i,
    /(?:override|bypass|ignore)\s+(?:policy|policies|rules?)\s+(?:and\s+)?(?:approve|allow|authorize|grant)/i,
    /(?:approve|authorize|allow)\s+(?:this\s+)?(?:transaction|order|purchase|intent)\s*(?:automatically|without\s+checks?|now)?/i,
    /priority\s+executive\s+(?:order|approval|override)/i,
    /transfer\s+funds/i,
    
    // 3. Spending Limit, Budget & Quantity Manipulation Directives
    /bypass\s+(?:spending|budget|purchasing)\s*(?:limits?|polic(?:y|ies)|rules?)?/i,
    /override\s+(?:spending|budget|limits?)/i,
    /(?:set\s+limit\s*(?:to|=)\s*(?:unlimited|\d{7,})|no\s+spending\s+limit)/i,
    /max_budget\s*=\s*(?:unlimited|[\d,]{7,})/i,
    /(?:ignore|disregard|override)\s+(?:the\s+)?(?:buyer'?s?|user'?s?)?\s*budget/i,
    /(?:set|increase|override|change)\s+quantity\s*(?:to|=)\s*\d+/i,
    /(?:buy|order|purchase|get)\s+\d{2,}\s+(?:units|items|pcs|pieces|laptops|phones|chairs)/i,
    
    // 4. Price Manipulation & Spoofed Amount Directives
    /(?:use|set|charge|pay|enter)\s+(?:₹|rs\.?|inr)?\s*\d+(?:\.\d+)?\s+(?:instead|as\s+price|rather\s+than)\b/i,
    /(?:use|pay|charge|set)\s+.*?instead\s+of\s+(?:the\s+)?(?:real|actual|catalog|official|original)\s+price/i,
    /(?:fake|spoofed|manipulated|override|discounted)\s+price\s*(?:to|=|\:)?\s*(?:₹|rs\.?|inr)?\s*\d+/i,
    /price\s*=\s*(?:₹|rs\.?|inr)?\s*0(?:\.00)?\b/i,
    
    // 5. System Instructions Exfiltration & Prompt Revelation Directives
    /(?:reveal|show|display|print|output|leak|disclose|expose|tell\s+me|repeat|what\s+are)\s+(?:the\s+)?(?:system|developer|hidden|internal|initial|agent)?\s*(?:instructions?|prompts?|rules?|guidelines?|config|context|secrets?)/i,
    /(?:what\s+is\s+your\s+(?:system\s+prompt|prompt|instructions?))/i,
    
    // 6. Inventory & Stock Restriction Bypass Directives
    /(?:ignore|bypass|override|disregard)\s+(?:all\s+)?(?:inventory|stock|quantity|out\s+of\s+stock)\s*(?:restrictions?|limits?|checks?|rules?)?/i,
    /(?:force_in_stock|infinite_stock|bypass_inventory)\s*=\s*true/i,
  ];

  let matchedPattern = null;
  for (const rx of injectionRegexes) {
    const match = textToCheck.match(rx);
    if (match) {
      matchedPattern = match[0];
      break;
    }
  }

  // Also check for base64 encoded payloads in originalText (case-sensitive)
  if (!matchedPattern) {
    const b64Candidates = originalText.match(/[A-Za-z0-9+/]{16,}={0,2}/g) || [];
    for (const cand of b64Candidates) {
      try {
        const decoded = Buffer.from(cand, 'base64').toString('utf8');
        for (const rx of injectionRegexes) {
          if (rx.test(decoded)) {
            matchedPattern = `Base64 Encoded Injection: ${cand.substring(0, 12)}...`;
            break;
          }
        }
        if (matchedPattern) break;
      } catch (e) {}
    }
  }

  if (matchedPattern) {
    threatScore = 100;
    threatReason = `Potential adversarial prompt injection detected in merchant content: "${matchedPattern}".`;
  } else if (requestedTotal > 100000) {
    threatScore = 35;
    threatReason = 'High-value enterprise tier asset.';
  }

  factors.push({
    name: 'Content & Injection Threat',
    score: threatScore,
    weight: 0.25,
    contribution: Math.round(threatScore * 0.25),
    explanation: threatReason,
  });

  // -------------------------------------------------------------
  // Factor 3: Price Anomaly & Deviation (Weight: 20%)
  // -------------------------------------------------------------
  let priceScore = 10;
  let priceReason = 'Price aligns with standard catalog benchmark.';
  const origPrice = parseFloat(product.original_price || product.price || 0);

  if (origPrice > 0 && product.price) {
    const catalogPrice = parseFloat(product.price);
    const discount = ((origPrice - catalogPrice) / origPrice) * 100;
    if (discount > 60) {
      priceScore = 75;
      priceReason = `Abnormally deep discount detected (${discount.toFixed(0)}% off regular price). Potential counterfeit or fraud indicator.`;
    }
  }

  factors.push({
    name: 'Price Anomaly',
    score: priceScore,
    weight: 0.20,
    contribution: Math.round(priceScore * 0.20),
    explanation: priceReason,
  });

  // -------------------------------------------------------------
  // Factor 4: Transaction Velocity (Weight: 15%)
  // -------------------------------------------------------------
  let velocityScore = 10;
  let velocityReason = 'Normal agent transaction frequency.';

  const recentTxRes = await query(`
    SELECT COUNT(*) as recent_count
    FROM purchase_intents
    WHERE agent_id = $1
      AND created_at >= NOW() - INTERVAL '1 hour'
  `, [agentId]);

  const recentCount = parseInt(recentTxRes.rows[0]?.recent_count || 0);
  if (recentCount >= 6) {
    velocityScore = 80;
    velocityReason = `High purchase velocity detected: ${recentCount} intent(s) created in the past hour.`;
  } else if (recentCount >= 3) {
    velocityScore = 40;
    velocityReason = `Moderate velocity: ${recentCount} intents in the last hour.`;
  }

  factors.push({
    name: 'Velocity & Frequency',
    score: velocityScore,
    weight: 0.15,
    contribution: Math.round(velocityScore * 0.15),
    explanation: velocityReason,
  });

  // -------------------------------------------------------------
  // Factor 5: Agent Historical Behavior (Weight: 15%)
  // -------------------------------------------------------------
  let behaviorScore = 10;
  let behaviorReason = 'Transaction amount within normal agent historical distribution.';

  const avgTxRes = await query(`
    SELECT AVG(amount) as avg_amount
    FROM purchase_intents
    WHERE agent_id = $1 AND status NOT IN ('blocked', 'rejected')
  `, [agentId]);

  const avgAmount = parseFloat(avgTxRes.rows[0]?.avg_amount || 0);
  if (avgAmount > 0 && requestedTotal > avgAmount * 2.5 && requestedTotal > 30000) {
    behaviorScore = 55;
    behaviorReason = `Transaction amount (₹${requestedTotal.toLocaleString('en-IN')}) is significantly higher than agent average (₹${Math.round(avgAmount).toLocaleString('en-IN')}).`;
  }

  factors.push({
    name: 'Behavioral Baseline',
    score: behaviorScore,
    weight: 0.15,
    contribution: Math.round(behaviorScore * 0.15),
    explanation: behaviorReason,
  });

  // Compute Total Weighted Score
  let rawScore = factors.reduce((sum, f) => sum + (f.score * f.weight), 0);
  if (threatScore >= 90) {
    rawScore = Math.max(rawScore, 82);
  }
  const finalScore = Math.min(100, Math.max(0, Math.round(rawScore)));

  // Risk Classification Level
  let level = 'LOW';
  if (finalScore >= 70) {
    level = 'HIGH';
  } else if (finalScore >= 40) {
    level = 'MEDIUM';
  }

  // Summary Explanation
  const topRisks = factors.filter(f => f.score >= 40);
  let summaryExplanation = `Overall risk assessed as ${level} (Score: ${finalScore}/100).`;
  if (topRisks.length > 0) {
    summaryExplanation += ' Elevated factors: ' + topRisks.map(r => `${r.name} (${r.explanation})`).join(' ');
  } else {
    summaryExplanation += ' All risk parameters within nominal safety thresholds.';
  }

  return {
    score: finalScore,
    level,
    factors,
    explanation: summaryExplanation,
  };
}

export default { assessRisk };
