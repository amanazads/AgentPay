import re
import base64
from typing import Dict, Any, List

class PromptInjectionGuard:
    """
    Guarantees that untrusted merchant descriptions, product names,
    specifications, and user inputs are strictly encapsulated as DATA,
    never instruction sources or authorization modifiers.
    """

    INJECTION_PATTERNS = [
        # 1. Instruction Overrides & Jailbreak Directives
        r"(?:ignore|disregard|forget|override|cancel|bypass)\s+(?:all\s+)?(?:(?:previous|prior|existing|above|system|developer|policy|spending)\s+)?(?:the\s+)?(?:rules|instructions|prompts|commands|constraints|limits|policies|policy)",
        r"(?:new\s+instructions?|system\s+override|priority\s+override|jailbreak|developer\s+mode)",
        
        # 2. Fake System Messages & Delimiter Injection
        r"\[(?:SYSTEM|DEVELOPER|ADMIN|ROOT)\]",
        r"<\|im_start\|>system",
        r"<<SYS>>|<SYS>",
        r"-{2,}\s*BEGIN\s+(?:SYSTEM|ADMIN)\s+(?:MESSAGE|INSTRUCTION)\s*-{2,}",
        r"###\s*System:",
        r"(?:system\s*:\s*you\s+are|developer\s*:\s*instruction)",

        # 3. Fake Admin Commands & Role Escalations
        r"(?:admin\s+(?:command|mode|privilege|override)|sudo\s+(?:approve|authorize|execute|buy|grant)|grant\s+(?:admin|root|permission|authorization)|root\s+(?:access|privilege))",
        r"(?:set_approval\s*=\s*(?:auto|true|allow|bypass)|auto_approve\s*=\s*true)",
        r"priority\s+executive\s+order",
        r"transfer\s+funds",
        
        # 4. Spending Limit & Policy Manipulation
        r"bypass\s+(?:spending|budget|purchasing)\s*(?:limits?|polic(?:y|ies)|rules?)?",
        r"override\s+(?:spending|budget|limits?)",
        r"(?:set\s+limit\s*(?:to|=)\s*(?:unlimited|\d{7,})|no\s+spending\s+limit)",
        r"max_budget\s*=\s*(?:unlimited|[\d,]{7,})",
        
        # 5. Quantity Manipulation Directives
        r"(?:set|increase|override)\s+quantity\s*(?:to|=)\s*\d+",
        r"(?:buy|order)\s+\d{3,}\s+units",
    ]

    @classmethod
    def sanitize_untrusted_content(cls, content: str) -> str:
        """
        Wraps content in strict data delimiters and neutralizes dangerous command syntax.
        """
        if not content:
            return ""
        
        sanitized = content.replace("```", "'''").replace("<|im_start|>", "[im_start]").replace("<<SYS>>", "[SYS]")
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
        and encoded payloads.
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
            if re.search(pattern, text, re.IGNORECASE):
                matched.append(pattern)

        # Also inspect potential encoded payloads
        encoded_matches = cls._check_encoded_payloads(text)
        matched.extend(encoded_matches)
                
        is_threat = len(matched) > 0
        return {
            "threat_detected": is_threat,
            "patterns_matched": matched,
            "threat_level": "HIGH" if is_threat else "LOW",
            "category": "PROMPT_INJECTION_THREAT" if is_threat else "CLEAN",
        }
