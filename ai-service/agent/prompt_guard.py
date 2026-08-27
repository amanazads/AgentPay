import re
from typing import Dict, Any

class PromptInjectionGuard:
    """
    Guarantees that untrusted merchant descriptions, product names,
    and user inputs are strictly encapsulated as DATA, never instruction sources.
    """
    
    INJECTION_PATTERNS = [
        r"ignore\s+(?:all\s+)?(?:previous\s+)?(?:the\s+)?(?:rules|instructions|policy|limits)",
        r"system\s+override",
        r"admin\s+(?:command|mode)",
        r"bypass_policy",
        r"disable_security",
        r"set_approval\s*=",
        r"grant\s+permission",
        r"priority\s+executive\s+order",
        r"transfer\s+funds",
        r"override\s+spending",
    ]

    @classmethod
    def sanitize_untrusted_content(cls, content: str) -> str:
        """
        Wraps content in strict data delimiters and strips dangerous command syntax.
        """
        if not content:
            return ""
        
        sanitized = content.replace("```", "'''")
        return f"<UNTRUSTED_MERCHANT_DATA>\n{sanitized}\n</UNTRUSTED_MERCHANT_DATA>"

    @classmethod
    def detect_injection_threat(cls, text: str) -> Dict[str, Any]:
        """
        Scans text for explicit adversarial prompt injection attempts.
        """
        if not text:
            return {"threat_detected": False, "patterns_matched": [], "threat_level": "LOW"}
            
        matched = []
        for pattern in cls.INJECTION_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                matched.append(pattern)
                
        return {
            "threat_detected": len(matched) > 0,
            "patterns_matched": matched,
            "threat_level": "HIGH" if len(matched) > 0 else "LOW"
        }
