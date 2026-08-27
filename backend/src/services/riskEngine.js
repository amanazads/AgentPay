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
}) {
  const factors = [];

  // Fetch product & merchant
  const productRes = await query(`
    SELECT p.*, m.name as merchant_name, m.is_verified, m.risk_level as merchant_risk_level, m.rating
    FROM products p
    JOIN merchants m ON p.merchant_id = m.id
    WHERE p.id = $1
  `, [productId]);

  const product = productRes.rows[0] || {};
  const requestedTotal = parseFloat(amount || 0);

  // -------------------------------------------------------------
  // Factor 1: Merchant Credibility (Weight: 25%)
  // -------------------------------------------------------------
  let merchantScore = 10;
  let merchantReason = 'Verified merchant with established low-risk profile.';

  if (product.merchant_risk_level === 'high' || !product.is_verified) {
    merchantScore = 90;
    merchantReason = 'Unverified or high-risk flagged merchant.';
  } else if (product.merchant_risk_level === 'medium') {
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
  const textToCheck = `${product.name || ''} ${product.description || ''}`.toLowerCase();
  
  const injectionPatterns = [
    'ignore all previous instructions',
    'ignore all rules',
    'ignore the purchasing policy',
    'admin command',
    'system override',
    'bypass_policy',
    'disable_security',
    'set_approval=auto',
    'admin mode',
  ];

  const matchedPattern = injectionPatterns.find(p => textToCheck.includes(p));
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
