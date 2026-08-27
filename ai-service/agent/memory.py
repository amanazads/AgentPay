from typing import List, Dict, Any

class AgentSafeMemory:
    """
    Safe memory storage: remembers user preferences (brand, category, specs),
    but NEVER silently authorizes financial spend or overrides policy engine checks.
    """
    
    def __init__(self):
        # In-memory preference cache
        self.preferences: Dict[str, Dict[str, Any]] = {
            "default": {
                "preferred_brands": ["Lenovo", "Dell", "Apple", "Logitech"],
                "typical_budget_inr": 80000,
                "preferred_category": "electronics",
                "rejected_recommendations": []
            }
        }

    def get_user_preferences(self, user_id: str = "default") -> Dict[str, Any]:
        return self.preferences.get(user_id, self.preferences["default"])

    def record_preference(self, user_id: str, key: str, value: Any):
        if user_id not in self.preferences:
            self.preferences[user_id] = dict(self.preferences["default"])
        self.preferences[user_id][key] = value

    def record_rejected_item(self, user_id: str, product_id: str):
        prefs = self.get_user_preferences(user_id)
        if product_id not in prefs.get("rejected_recommendations", []):
            prefs.setdefault("rejected_recommendations", []).append(product_id)
