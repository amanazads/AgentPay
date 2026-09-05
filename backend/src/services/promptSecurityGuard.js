/**
 * AgentPay Backend Prompt-Injection & Content Security Guard
 * ==========================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * The Python AI service has its own prompt guard, but it only runs when the AI
 * service is reachable. `/api/ai/chat` falls back to a deterministic
 * orchestrator when that service is down — which previously meant the entire
 * injection defence disappeared exactly when the system was degraded.
 *
 * This module is the backend-side, always-on guard. It runs BEFORE the AI
 * service is called and therefore also protects the fallback path, so the
 * security policy is identical whether Gemini is available or not.
 *
 * THREAT MODEL
 * ------------
 * Two untrusted sources:
 *   1. USER INPUT — the buyer's natural-language request.
 *   2. MERCHANT CONTENT — titles, descriptions, specifications, AI metadata,
 *      reviews, merchant names. Merchants are semi-trusted at best.
 *
 * CORE INVARIANT: "Merchant content is DATA, never AUTHORITY."
 *
 * WHAT THIS MODULE IS AND IS NOT
 * ------------------------------
 * This is a detection layer, and detection layers are defeatable. It is NOT the
 * thing that keeps money safe. Money is kept safe by the deterministic pipeline
 * downstream — authoritative catalog, policy engine, price-lock quotes,
 * server-side payment verification — none of which read free text. If a novel
 * obfuscation slips past this guard, the worst outcome is a poor product
 * recommendation, not an unauthorized payment.
 */

// ---------------------------------------------------------------------------
// Normalization — defeats whitespace / Unicode / case obfuscation
// ---------------------------------------------------------------------------

// Zero-width and invisible formatting characters used to break up keywords.
const INVISIBLE_CHARS = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/g;

// Homoglyph folding: Cyrillic/Greek look-alikes and common leetspeak.
const HOMOGLYPHS = new Map(Object.entries({
  'а': 'a', 'ѕ': 's', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
  'і': 'i', 'ј': 'j', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't', 'в': 'b',
  'α': 'a', 'ε': 'e', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'ι': 'i', 'κ': 'k', 'ν': 'v',
  '０': '0', '１': '1', '３': '3', '４': '4', '５': '5', '７': '7',
}));

const LEET = new Map(Object.entries({
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i',
}));

/**
 * Produces the canonical text used for pattern matching.
 * Keeps word boundaries intact (so spaced patterns still work).
 */
export function normalizeForDetection(input) {
  if (input === null || input === undefined) return '';
  let text = String(input);

  // Unicode compatibility folding: handles fullwidth, ligatures, styled text.
  try {
    text = text.normalize('NFKC');
  } catch {
    /* normalize is always available on modern Node; ignore defensively */
  }

  text = text.replace(INVISIBLE_CHARS, '');

  // Fold homoglyphs before lowercasing (map keys are lowercase already).
  text = text.toLowerCase();
  text = Array.from(text).map((ch) => HOMOGLYPHS.get(ch) ?? ch).join('');

  // Normalize all Unicode whitespace variants to a single ASCII space.
  text = text.replace(/[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g, ' ');

  return text.trim();
}

/**
 * A second view of the text with every non-alphanumeric character removed and
 * leetspeak folded. Defeats "i.g.n.o.r.e", "i g n o r e", "1gn0r3".
 */
export function compactForDetection(input) {
  const normalized = normalizeForDetection(input);
  return Array.from(normalized)
    .map((ch) => LEET.get(ch) ?? ch)
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

// ---------------------------------------------------------------------------
// Encoded payload extraction
// ---------------------------------------------------------------------------

/**
 * Extracts plausible decoded payloads (base64, hex, percent-encoding) so an
 * encoded injection is scanned as plaintext.
 */
export function extractDecodedPayloads(input) {
  const text = String(input ?? '');
  const payloads = [];

  // Base64 (standard and URL-safe). Require reasonable length to limit noise.
  const b64Candidates = text.match(/[A-Za-z0-9+/_-]{16,}={0,2}/g) || [];
  for (const candidate of b64Candidates.slice(0, 40)) {
    const standard = candidate.replace(/-/g, '+').replace(/_/g, '/');
    const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
    try {
      const decoded = Buffer.from(padded, 'base64').toString('utf8');
      // Keep only decodes that look like real text, not binary noise.
      if (decoded && /^[\x09\x0A\x0D\x20-\x7E]{8,}$/.test(decoded)) {
        payloads.push({ encoding: 'base64', sample: candidate.slice(0, 16), decoded });
      }
    } catch {
      /* not valid base64 */
    }
  }

  // Hex-encoded ASCII.
  const hexCandidates = text.match(/(?:[0-9a-fA-F]{2}){12,}/g) || [];
  for (const candidate of hexCandidates.slice(0, 20)) {
    try {
      const decoded = Buffer.from(candidate, 'hex').toString('utf8');
      if (decoded && /^[\x09\x0A\x0D\x20-\x7E]{8,}$/.test(decoded)) {
        payloads.push({ encoding: 'hex', sample: candidate.slice(0, 16), decoded });
      }
    } catch {
      /* not valid hex */
    }
  }

  // Percent-encoding.
  if (/%[0-9a-fA-F]{2}/.test(text)) {
    try {
      const decoded = decodeURIComponent(text.replace(/%(?![0-9a-fA-F]{2})/g, '%25'));
      if (decoded !== text) {
        payloads.push({ encoding: 'percent', sample: 'percent-encoded', decoded });
      }
    } catch {
      /* malformed percent-encoding */
    }
  }

  return payloads;
}

// ---------------------------------------------------------------------------
// Detection rules
// ---------------------------------------------------------------------------

/**
 * Spaced-text rules. Matched against normalizeForDetection() output.
 * Each rule carries an id so audit records name the rule, not a raw regex.
 */
const SPACED_RULES = [
  // 1. Instruction overrides and jailbreaks
  { id: 'INSTRUCTION_OVERRIDE', re: /(?:ignore|disregard|forget|override|cancel|bypass|skip)\s+(?:all\s+|any\s+)?(?:the\s+)?(?:(?:previous|prior|preceding|earlier|existing|above|system|developer|policy|spending|safety|security|buyer'?s?|user'?s?)\s+)?(?:rules?|instructions?|prompts?|commands?|constraints?|limits?|polic(?:y|ies)|guidelines?|checks?|restrictions?)/ },
  { id: 'JAILBREAK_MODE', re: /(?:new\s+instructions?|system\s+override|priority\s+override|jailbreak|developer\s+mode|god\s+mode|dan\s+mode|do\s+anything\s+now)/ },
  { id: 'ROLE_ESCALATION', re: /(?:you\s+are\s+now|act\s+as|pretend\s+to\s+be|from\s+now\s+on\s+you)\s+(?:an?\s+)?(?:admin|administrator|root|developer|system|unrestricted)/ },

  // 2. Fake system messages and delimiter injection
  { id: 'FAKE_SYSTEM_TAG', re: /\[(?:\s*)(?:system|developer|admin|root|assistant|instruction|internal)(?:\s*)\]/ },
  { id: 'CHATML_INJECTION', re: /<\|im_(?:start|end)\|>|<\|endoftext\|>/ },
  { id: 'LLAMA_SYS_TAG', re: /<<\s*\/?\s*sys\s*>>|<\s*\/?\s*sys\s*>/ },
  { id: 'MARKDOWN_SYSTEM_HEADER', re: /#{1,6}\s*(?:system|developer|admin|instruction|internal)\s*[:：]/ },
  { id: 'BEGIN_SYSTEM_BLOCK', re: /-{2,}\s*(?:begin|start)\s+(?:system|admin|developer)\s+(?:message|instruction|prompt)/ },
  { id: 'SYSTEM_ROLE_PREFIX', re: /(?:^|\n)\s*(?:system|developer|admin)\s*[:：]\s*(?:you\s+are|ignore|approve|execute|override)/ },

  // 3. Fake admin commands, approvals, policy overrides
  { id: 'ADMIN_COMMAND', re: /(?:admin\s+(?:command|mode|privilege|override)|sudo\s+(?:approve|authorize|execute|buy|grant)|grant\s+(?:admin|root|permission|authorization)|root\s+(?:access|privilege))/ },
  { id: 'AUTO_APPROVE_FLAG', re: /(?:auto[_\s-]?approve|force[_\s-]?approve|set[_\s-]?approval|skip[_\s-]?approval|require[_\s-]?approval)\s*[=:]\s*(?:true|1|yes|auto|allow|bypass|false)/ },
  { id: 'POLICY_BYPASS_APPROVE', re: /(?:override|bypass|ignore|skip|disable)\s+(?:the\s+)?(?:polic(?:y|ies)|rules?|checks?|verification|validation)\s*(?:and\s+)?(?:approve|allow|authorize|grant|buy|purchase)?/ },
  { id: 'DIRECT_APPROVAL_COMMAND', re: /(?:approve|authorize|allow|confirm)\s+(?:this\s+|the\s+)?(?:transaction|order|purchase|intent|payment)\b/ },
  { id: 'APPROVE_WITHOUT_CHECKS', re: /(?:approve|authorize|allow|execute|proceed|complete|buy|purchase|checkout)\s+(?:this\s+|it\s+|the\s+\w+\s+)?(?:without|skipping|bypassing|sans|with\s+no)\s+(?:any\s+|further\s+|additional\s+)?(?:checks?|verification|validation|review|approvals?|confirmation|questions?|limits?)/ },
  { id: 'EXECUTIVE_OVERRIDE', re: /priority\s+executive\s+(?:order|approval|override)/ },
  { id: 'FUND_TRANSFER', re: /transfer\s+(?:funds|money|balance)/ },

  // 4. Spending limit, budget and quantity manipulation
  { id: 'SPENDING_LIMIT_BYPASS', re: /(?:bypass|override|ignore|remove|disable|raise|lift)\s+(?:my\s+|the\s+|all\s+)?(?:spending|budget|purchase|purchasing|transaction)\s*(?:limits?|caps?|polic(?:y|ies)|rules?|ceilings?)?/ },
  { id: 'UNLIMITED_BUDGET', re: /(?:set\s+(?:the\s+)?(?:limit|budget)\s*(?:to|=)\s*(?:unlimited|infinite|max|\d{7,})|no\s+spending\s+limit|budget\s*[=:]\s*unlimited|unlimited\s+budget)/ },
  { id: 'BUDGET_VARIABLE_SET', re: /(?:max[_\s-]?budget|spending[_\s-]?limit|budget[_\s-]?cap)\s*[=:]\s*(?:unlimited|infinite|[\d,]{6,})/ },
  { id: 'IGNORE_BUDGET', re: /(?:ignore|disregard|override|forget|exceed)\s+(?:the\s+|my\s+|his\s+|her\s+|their\s+)?(?:buyer'?s?\s+|user'?s?\s+)?budget/ },
  { id: 'QUANTITY_OVERRIDE', re: /(?:set|increase|override|change|multiply)\s+(?:the\s+)?quantity\s*(?:to|=|by)\s*\d+/ },

  // 5. Price manipulation
  { id: 'PRICE_SUBSTITUTION', re: /(?:use|set|charge|pay|enter|bill)\s+(?:₹|rs\.?|inr|\$)?\s*[\d,]+(?:\.\d+)?\s+(?:instead|as\s+(?:the\s+)?price|rather\s+than)/ },
  { id: 'PRICE_INSTEAD_OF', re: /(?:use|pay|charge|set|apply)\b[^.\n]{0,60}?instead\s+of\s+(?:the\s+)?(?:real|actual|catalog|listed|official|original)\s+price/ },
  { id: 'SPOOFED_PRICE', re: /(?:fake|spoofed|manipulated|overridden|override|forced)\s+price\s*(?:to|=|:)?\s*(?:₹|rs\.?|inr)?\s*[\d,]+/ },
  { id: 'ZERO_PRICE', re: /price\s*[=:]\s*(?:₹|rs\.?|inr)?\s*0(?:\.0+)?\b/ },

  // 6. System prompt exfiltration
  { id: 'PROMPT_EXFILTRATION', re: /(?:reveal|show|display|print|output|leak|disclose|expose|repeat|recite|dump|tell\s+me)\s+(?:me\s+)?(?:the\s+|your\s+|all\s+)?(?:system|developer|hidden|internal|initial|original|secret|agent)\s*(?:instructions?|prompts?|rules?|guidelines?|config(?:uration)?|context|messages?)/ },
  { id: 'PROMPT_QUESTION', re: /what\s+(?:is|are|was|were)\s+your\s+(?:system\s+)?(?:prompt|instructions?|rules?|guidelines?)/ },
  { id: 'CREDENTIAL_EXFILTRATION', re: /(?:reveal|show|print|leak|give\s+me|what\s+is)\s+(?:the\s+|your\s+)?(?:api[_\s-]?key|secret|token|password|credential|signing[_\s-]?key)/ },

  // 7. Inventory and eligibility bypass
  { id: 'INVENTORY_BYPASS', re: /(?:ignore|bypass|override|disregard|skip|disable)\s+(?:all\s+)?(?:the\s+)?(?:inventory|stock|availability)\s*(?:restrictions?|limits?|checks?|rules?)?/ },
  { id: 'STOCK_FLAG_SET', re: /(?:force[_\s-]?in[_\s-]?stock|infinite[_\s-]?stock|bypass[_\s-]?inventory|commerce[_\s-]?eligible|is[_\s-]?test[_\s-]?lab)\s*[=:]\s*(?:true|false|1)/ },

  // 8. Attempts to address the model as if it were the authority
  { id: 'AUTHORITY_ASSERTION', re: /(?:you\s+(?:have|now\s+have)\s+(?:full\s+)?(?:authority|permission|approval)|as\s+the\s+(?:payment\s+)?authority)/ },
];

/**
 * Compact rules. Matched against compactForDetection() output, which has all
 * separators removed — this is what catches "i g n o r e   a l l   r u l e s"
 * and "I-g-n-o-r-e" style obfuscation.
 */
const COMPACT_RULES = [
  { id: 'COMPACT_INSTRUCTION_OVERRIDE', re: /(?:ignore|disregard|forget|override|bypass)(?:all)?(?:previous|prior|above|thesystem|system)?(?:instructions?|rules?|prompts?|constraints?|polic(?:y|ies))/ },
  { id: 'COMPACT_AUTO_APPROVE', re: /(?:autoapprove|forceapprove|skipapproval)(?:true|1|yes)?/ },
  { id: 'COMPACT_SPENDING_BYPASS', re: /(?:bypass|override|ignore|remove)(?:my|the)?(?:spending|budget)(?:limit|cap|policy)?/ },
  { id: 'COMPACT_SYSTEM_TAG', re: /\bsystemoverride\b|\bdevelopermode\b|\bgodmode\b|\bjailbreak\b/ },
  { id: 'COMPACT_PROMPT_EXFIL', re: /(?:reveal|show|print|leak|dump)(?:your|the)?(?:system)?(?:prompt|instructions)/ },
  { id: 'COMPACT_UNLIMITED_BUDGET', re: /(?:unlimitedbudget|nospendinglimit|budgetunlimited)/ },
];

/**
 * Scans a single string and returns the rules it matched.
 */
function matchRules(text) {
  const spaced = normalizeForDetection(text);
  const compact = compactForDetection(text);
  const matched = [];

  for (const rule of SPACED_RULES) {
    if (rule.re.test(spaced)) matched.push(rule.id);
  }
  for (const rule of COMPACT_RULES) {
    if (rule.re.test(compact)) matched.push(rule.id);
  }
  return matched;
}

/**
 * Detects prompt-injection threats in a piece of text, including inside
 * base64 / hex / percent-encoded payloads.
 *
 * @param {string} text
 * @returns {{threatDetected: boolean, threatLevel: 'LOW'|'HIGH', category: string, matchedRules: string[], encodedFindings: object[]}}
 */
export function detectInjectionThreat(text) {
  if (text === null || text === undefined || String(text).trim() === '') {
    return { threatDetected: false, threatLevel: 'LOW', category: 'CLEAN', matchedRules: [], encodedFindings: [] };
  }

  const matchedRules = matchRules(text);
  const encodedFindings = [];

  for (const payload of extractDecodedPayloads(text)) {
    const inner = matchRules(payload.decoded);
    if (inner.length > 0) {
      encodedFindings.push({ encoding: payload.encoding, sample: payload.sample, matchedRules: inner });
      matchedRules.push(`${payload.encoding.toUpperCase()}_ENCODED_PAYLOAD`);
    }
  }

  const unique = [...new Set(matchedRules)];
  const threatDetected = unique.length > 0;

  return {
    threatDetected,
    threatLevel: threatDetected ? 'HIGH' : 'LOW',
    category: threatDetected ? 'PROMPT_INJECTION_THREAT' : 'CLEAN',
    matchedRules: unique,
    encodedFindings,
  };
}

// ---------------------------------------------------------------------------
// Merchant content handling — "merchant content is DATA, never AUTHORITY"
// ---------------------------------------------------------------------------

/**
 * Neutralizes prompt syntax in untrusted merchant content and wraps it in
 * explicit data delimiters, so it can be shown to a model without being read
 * as instructions.
 */
export function sanitizeUntrustedContent(content) {
  if (content === null || content === undefined) return '';

  let sanitized = String(content)
    .replace(INVISIBLE_CHARS, '')
    .replace(/```/g, "'''")
    .replace(/<\|im_(start|end)\|>/gi, '[im_$1]')
    .replace(/<<\s*\/?\s*sys\s*>>/gi, '[sys]')
    .replace(/\[\s*(system|developer|admin|root|assistant|instruction)\s*\]/gi, '[CONTENT]')
    .replace(/#{1,6}\s*(system|developer|admin|instruction)\s*[:：]/gi, '### Content:')
    .replace(/<\/?(UNTRUSTED_CATALOG_DATA)>/gi, '');

  // Cap length so a merchant cannot flood the context window.
  if (sanitized.length > 4000) {
    sanitized = `${sanitized.slice(0, 4000)}…[truncated]`;
  }

  return `<UNTRUSTED_CATALOG_DATA>\n${sanitized}\n</UNTRUSTED_CATALOG_DATA>`;
}

/**
 * Fields of a catalog product that originate from the merchant and must be
 * treated as untrusted free text.
 */
const MERCHANT_TEXT_FIELDS = [
  'name', 'title', 'description', 'brand', 'category', 'productType', 'product_type',
  'sku', 'keywords', 'merchantName', 'merchant_name', 'reason', 'selectionReason',
];

/**
 * Scans a catalog product's merchant-authored content for injection attempts.
 *
 * Returns the findings; it deliberately does NOT mutate pricing, inventory,
 * policy or eligibility. Those are decided by the deterministic pipeline from
 * authoritative database columns, and no string a merchant writes can move them.
 *
 * @param {object} product
 * @returns {{clean: boolean, findings: Array<{field: string, matchedRules: string[]}>}}
 */
export function scanMerchantContent(product) {
  const findings = [];
  if (!product || typeof product !== 'object') return { clean: true, findings };

  const inspect = (label, value) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number') {
      const result = detectInjectionThreat(String(value));
      if (result.threatDetected) findings.push({ field: label, matchedRules: result.matchedRules });
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 50).forEach((item, i) => inspect(`${label}[${i}]`, item));
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value).slice(0, 100)) {
        inspect(`${label}.${k}`, v);
      }
    }
  };

  for (const field of MERCHANT_TEXT_FIELDS) {
    if (product[field] !== undefined) inspect(field, product[field]);
  }

  // Nested blobs merchants control: specifications and AI metadata.
  inspect('specifications', product.specifications ?? product.specificationsNormalized);
  inspect('aiMetadata', product.aiMetadata ?? product.ai_metadata);
  inspect('reviews', product.reviews);

  return { clean: findings.length === 0, findings };
}

/**
 * The canonical response body returned to a buyer whose request was blocked.
 *
 * Shape note: this deliberately carries no recommendation, no purchase intent,
 * no quote and no payment order — there is nothing for a client to act on.
 */
export function buildBlockedResponse({ agentName = 'Procurement Agent', matchedRules = [], reason = null } = {}) {
  return {
    status: 'BLOCKED',
    execution_status: 'BLOCKED',
    agent_name: agentName,
    reply: reason || [
      "I've blocked this request.",
      '',
      "AgentPay's security layer detected an attempt to override my instructions, spending policy, or pricing authority. Requests like this are rejected before any product search, price quote, inventory reservation, or payment can happen.",
      '',
      'Nothing was purchased and no funds were moved. If this was a genuine shopping request, please rephrase it as a plain description of what you want to buy.',
    ].join('\n'),
    intent_parsed: null,
    recommendation: null,
    comparison: [],
    order: null,
    invoice: null,
    purchase_intent: null,
    proposed_action: null,
    quote: null,
    authorization_status: {
      state: 'BLOCK',
      explanation: 'Request blocked by AgentPay prompt-injection security guard.',
      policy_summary: 'No purchase intent created. No quote issued. No inventory reserved. No payment authorized.',
    },
    security: {
      blocked: true,
      layer: 'backend-prompt-security-guard',
      // Rule ids only — never echo the attack string back into the UI.
      matched_rules: matchedRules,
    },
    tools_called: ['detect_injection_threat'],
  };
}

export default {
  normalizeForDetection,
  compactForDetection,
  extractDecodedPayloads,
  detectInjectionThreat,
  sanitizeUntrustedContent,
  scanMerchantContent,
  buildBlockedResponse,
};
