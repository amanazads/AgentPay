import re
import base64
from typing import Dict, Any, List

class PromptInjectionGuard:
    """
    Guarantees that untrusted merchant descriptions, product names,
    reviews, specifications, and user inputs are strictly encapsulated as DATA,
    never instruction sources or authorization modifiers.
    
    Core Invariant: "Merchant content is DATA, never AUTHORITY."
    """

    INJECTION_PATTERNS = [
        # 1. Instruction Overrides, Jailbreak Directives & Role Escalation
        r"(?:ignore|disregard|forget|override|cancel|bypass)\s+(?:all\s+)?(?:(?:previous|prior|existing|above|system|developer|policy|spending|buyer'?s?|user'?s?)\s+)?(?:the\s+)?(?:rules|instructions|prompts|commands|constraints|limits|policies|policy|budget|guidelines)",
        r"(?:new\s+instructions?|system\s+override|priority\s+override|jailbreak|developer\s+mode|god\s+mode)",
        
        # 2. Fake System Messages & Delimiter Injection
        r"\[(?:SYSTEM|DEVELOPER|ADMIN|ROOT|ASSISTANT|INSTRUCTION)\]",
        r"<\|im_start\|>(?:system|developer|admin)?",
        r"<<SYS>>|<SYS>|<\/SYS>|<<\/SYS>>",
        r"-{2,}\s*BEGIN\s+(?:SYSTEM|ADMIN|DEVELOPER)\s+(?:MESSAGE|INSTRUCTION)\s*-{2,}",
        r"###\s*(?:System|Developer|Admin|Instruction):",
        r"(?:system\s*:\s*you\s+are|developer\s*:\s*instruction|admin\s*:\s*execute)",

        # 3. Fake Admin Commands, Approvals & Policy Overrides
        r"(?:admin\s+(?:command|mode|privilege|override)|sudo\s+(?:approve|authorize|execute|buy|grant)|grant\s+(?:admin|root|permission|authorization)|root\s+(?:access|privilege))",
        r"(?:set_approval\s*=\s*(?:auto|true|allow|bypass)|auto_approve\s*=\s*true|force_approve\s*=\s*true)",
        r"(?:override|bypass|ignore)\s+(?:policy|policies|rules?)\s+(?:and\s+)?(?:approve|allow|authorize|grant)",
        r"(?:approve|authorize|allow)\s+(?:this\s+)?(?:transaction|order|purchase|intent)\s*(?:automatically|without\s+checks?|now)?",
        r"priority\s+executive\s+(?:order|approval|override)",
        r"transfer\s+funds",
        
        # 4. Spending Limit, Budget & Quantity Manipulation Directives
        r"bypass\s+(?:spending|budget|purchasing)\s*(?:limits?|polic(?:y|ies)|rules?)?",
        r"override\s+(?:spending|budget|limits?)",
        r"(?:set\s+limit\s*(?:to|=)\s*(?:unlimited|\d{7,})|no\s+spending\s+limit)",
        r"max_budget\s*=\s*(?:unlimited|[\d,]{7,})",
        r"(?:ignore|disregard|override)\s+(?:the\s+)?(?:buyer'?s?|user'?s?)?\s*budget",
        r"(?:set|increase|override|change)\s+quantity\s*(?:to|=)\s*\d+",
        r"(?:buy|order|purchase|get)\s+\d{2,}\s+(?:units|items|pcs|pieces|laptops|phones|chairs)",
        
        # 5. Price Manipulation & Spoofed Amount Directives
        r"(?:use|set|charge|pay|enter)\s+(?:₹|rs\.?|inr)?\s*\d+(?:\.\d+)?\s+(?:instead|as\s+price|rather\s+than)\b",
        r"(?:use|pay|charge|set)\s+.*?instead\s+of\s+(?:the\s+)?(?:real|actual|catalog|official|original)\s+price",
        r"(?:fake|spoofed|manipulated|override|discounted)\s+price\s*(?:to|=|\:)?\s*(?:₹|rs\.?|inr)?\s*\d+",
        r"price\s*=\s*(?:₹|rs\.?|inr)?\s*0(?:\.00)?\b",
        
        # 6. System Instructions Exfiltration & Prompt Revelation Directives
        r"(?:reveal|show|display|print|output|leak|disclose|expose|tell\s+me|repeat|what\s+are)\s+(?:the\s+)?(?:system|developer|hidden|internal|initial|agent)?\s*(?:instructions?|prompts?|rules?|guidelines?|config|context|secrets?)",
        r"(?:what\s+is\s+your\s+(?:system\s+prompt|prompt|instructions?))",
        
        # 7. Inventory & Stock Restriction Bypass Directives
        r"(?:ignore|bypass|override|disregard)\s+(?:all\s+)?(?:inventory|stock|quantity|out\s+of\s+stock)\s*(?:restrictions?|limits?|checks?|rules?)?",
        r"(?:force_in_stock|infinite_stock|bypass_inventory)\s*=\s*true",
    ]

    @classmethod
    def sanitize_untrusted_content(cls, content: str) -> str:
        """
        Wraps untrusted merchant content (titles, descriptions, reviews, specs, metadata)
        in strict data delimiters and neutralizes dangerous prompt syntax.
        """
        if not content:
            return ""
        
        sanitized = str(content)
        sanitized = sanitized.replace("```", "'''")
        sanitized = sanitized.replace("<|im_start|>", "[im_start]")
        sanitized = sanitized.replace("<<SYS>>", "[SYS]")
        sanitized = sanitized.replace("</SYS>", "[/SYS]")
        sanitized = sanitized.replace("### System:", "### Content:")
        sanitized = sanitized.replace("[SYSTEM]", "[CONTENT]")
        sanitized = sanitized.replace("[DEVELOPER]", "[CONTENT]")
        sanitized = sanitized.replace("[ADMIN]", "[CONTENT]")
        
        return f"<UNTRUSTED_CATALOG_DATA>\n{sanitized}\n</UNTRUSTED_CATALOG_DATA>"

    @classmethod
    def _check_encoded_payloads(cls, text: str) -> List[str]:
        """
        Scans for base64-encoded strings that may conceal malicious prompt injection tokens.
        """
        detected = []
        b64_candidates = re.findall(r'[A-Za-z0-9+/]{16,}={0,2}', text)
        for cand in b64_candidates:
            try:
                decoded = base64.b64decode(cand).decode('utf-8', errors='ignore')
                for pattern in cls.INJECTION_PATTERNS:
                    if re.search(pattern, decoded, re.IGNORECASE):
                        detected.append(f"BASE64_ENCODED_PAYLOAD: {cand[:12]}...")
                        break
            except Exception:
                pass
        return detected

    @classmethod
    def detect_injection_threat(cls, text: str) -> Dict[str, Any]:
        """
        Scans text for explicit adversarial prompt injection attempts,
        including instruction overrides, fake system tags, admin commands,
        price/quantity manipulation, prompt exfiltration, and encoded payloads.
        """
        if not text:
            return {
                "threat_detected": False,
                "patterns_matched": [],
                "threat_level": "LOW",
                "category": "CLEAN",
            }
            
        matched = []
        for pattern in cls.INJECTION_PATTERNS:
            if re.search(pattern, str(text), re.IGNORECASE):
                matched.append(pattern)

        # Also inspect potential encoded payloads
        encoded_matches = cls._check_encoded_payloads(str(text))
        matched.extend(encoded_matches)
                
        is_threat = len(matched) > 0
        return {
            "threat_detected": is_threat,
            "patterns_matched": matched,
            "threat_level": "HIGH" if is_threat else "LOW",
            "category": "PROMPT_INJECTION_THREAT" if is_threat else "CLEAN",
        }
