from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class ChatRequest(BaseModel):
    message: str = Field(..., description="Natural language prompt from the user")
    agent_id: Optional[str] = Field(None, description="Target Agent ID")
    user_id: Optional[str] = Field(None, description="User ID")

class ProductRecommendation(BaseModel):
    product_id: str
    name: str
    price: float
    merchant_name: str
    reason: str
    specifications: Dict[str, Any] = {}

class ProposedAction(BaseModel):
    type: str = "CREATE_PURCHASE_INTENT"
    product_id: str
    product_name: str
    amount: float
    merchant_id: Optional[str] = None
    merchant_name: Optional[str] = None

class AuthorizationStatus(BaseModel):
    state: str = "AWAITING_POLICY_EVALUATION"
    explanation: str
    policy_summary: str

class ChatResponse(BaseModel):
    status: str = "MATCH_FOUND"
    agent_name: str
    reply: str
    intent_parsed: Dict[str, Any]
    recommendation: Optional[ProductRecommendation] = None
    proposed_action: Optional[ProposedAction] = None
    authorization_status: AuthorizationStatus
    tools_called: List[str] = []
    purchase_intent: Optional[Dict[str, Any]] = None
    evaluation: Optional[Dict[str, Any]] = None
