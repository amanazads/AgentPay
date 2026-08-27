import re
import httpx
from typing import Dict, Any, Optional, List
import google.generativeai as genai
from config import settings
from models.schemas import ChatResponse, ProductRecommendation, ProposedAction, AuthorizationStatus
from agent.tools import AgentTools
from agent.prompt_guard import PromptInjectionGuard
from agent.memory import AgentSafeMemory

if settings.GEMINI_API_KEY:
    try:
        genai.configure(api_key=settings.GEMINI_API_KEY)
    except Exception as e:
        print(f"[Gemini Config Warning] {e}")

class AIBuyerAgent:
    """
    AI Buyer Agent for AgentPay
    Parses user requests, executes tool discovery, compares options,
    proposes structured purchase intents, and submits them to AgentPay for authorization.
    """
    
    def __init__(self, tools: Optional[AgentTools] = None, memory: Optional[AgentSafeMemory] = None):
        self.tools = tools or AgentTools()
        self.memory = memory or AgentSafeMemory()

    def parse_user_intent(self, message: str) -> Dict[str, Any]:
        msg_lower = message.lower()
        
        # 1. Budget extraction (e.g. "under ₹5,000", "worth rupees 5000", "under 5,000", "50k")
        budget = None
        budget_match = re.search(r'(?:under|below|less than|budget|max|up to|for|worth|price of|around|within|rupees|rs\.?|inr)\s*(?:₹|rs\.?|inr|rupees)?\s*([\d,]+)(?:k)?', msg_lower)
        if budget_match:
            raw_val = budget_match.group(1).replace(',', '')
            val = float(raw_val)
            if 'k' in msg_lower[budget_match.start():budget_match.end() + 2]:
                val *= 1000
            budget = val
        else:
            num_match = re.search(r'(?:₹|rs\.?|inr|rupees)\s*([\d,]+)', msg_lower)
            if num_match:
                budget = float(num_match.group(1).replace(',', ''))

        # 2. Quantity extraction (e.g. "Order 5 chairs", "buy 2 laptops")
        quantity = 1
        qty_match = re.search(r'(?:order|buy|purchase|get|find)\s+(\d+)\s+', msg_lower)
        if qty_match:
            try:
                quantity = max(1, int(qty_match.group(1)))
            except Exception:
                quantity = 1

        # 3. Product Type extraction
        product_type = None
        category = None
        if any(w in msg_lower for w in ["power bank", "powerbank", "portable charger", "battery pack", "powercore"]):
            product_type = "power_bank"
            category = "electronics"
        elif any(w in msg_lower for w in ["headphone", "headphones", "earphones", "earbuds", "airpods", "wh-1000xm5", "quietcomfort", "accentum"]):
            product_type = "headphones"
            category = "electronics"
        elif any(w in msg_lower for w in ["laptop", "computer", "macbook", "thinkpad", "zephyrus", "tuf"]):
            product_type = "laptop"
            category = "electronics"
        elif any(w in msg_lower for w in ["monitor", "display", "screen", "ultrasharp", "ultrafine", "4k"]):
            product_type = "monitor"
            category = "peripherals"
        elif any(w in msg_lower for w in ["mouse", "trackpad", "mx master"]):
            product_type = "mouse"
            category = "peripherals"
        elif any(w in msg_lower for w in ["keyboard", "keychron"]):
            product_type = "keyboard"
            category = "peripherals"
        elif any(w in msg_lower for w in ["chair", "aeron", "seating"]):
            product_type = "chair"
            category = "furniture"
        elif any(w in msg_lower for w in ["desk", "standing desk"]):
            product_type = "desk"
            category = "furniture"
        elif any(w in msg_lower for w in ["software", "figma", "jetbrains", "license"]):
            product_type = "software"
            category = "software"

        # 4. Explicit Hard Constraints
        required_capacity_mah = None
        cap_match = re.search(r'(\d{4,6})\s*(?:mah|milliamp)', msg_lower)
        if cap_match:
            required_capacity_mah = int(cap_match.group(1))

        required_ram_gb = None
        ram_match = re.search(r'(\d{1,3})\s*(?:gb|gigabytes?)\s*(?:ram|memory)?', msg_lower)
        if ram_match and (product_type == 'laptop' or 'ram' in msg_lower or 'memory' in msg_lower):
            required_ram_gb = int(ram_match.group(1))

        required_anc = True if ('anc' in msg_lower or 'noise cancel' in msg_lower) else False

        return {
            "query": message,
            "product_type": product_type,
            "category": category,
            "max_budget": budget,
            "quantity": quantity,
            "required_capacity_mah": required_capacity_mah,
            "required_ram_gb": required_ram_gb,
            "required_anc": required_anc,
            "constraints": [
                f"Type: {product_type}" if product_type else None,
                f"Budget <= ₹{budget:,.0f}" if budget else None,
                f"Capacity >= {required_capacity_mah}mAh" if required_capacity_mah else None,
                f"RAM >= {required_ram_gb}GB" if required_ram_gb else None,
                "ANC Supported" if required_anc else None,
            ],
        }

    def evaluate_candidate_eligibility(self, product: Dict[str, Any], intent: Dict[str, Any]) -> tuple[bool, List[str]]:
        """
        Strict server-side validation. Enforces: NO MATCH = REJECT.
        """
        p_name = (product.get("name") or "").lower()
        p_type = (product.get("product_type") or "").lower()
        p_price = float(product.get("price") or 0)
        p_cat = (product.get("category") or "").lower()
        p_specs = product.get("specifications") or {}
        if isinstance(p_specs, str):
            p_specs = {}

        # 1. Test Lab & Fixture Isolation
        if product.get("is_test_lab") is True or p_name.startswith("test ") or p_name.startswith("fake ") or p_name.startswith("safety test"):
            return False, ["Test lab fixture ineligible for production commerce."]

        # 2. Stock Check
        if not product.get("in_stock", True):
            return False, ["Product is out of stock."]

        # 3. Budget Rule
        max_budget = intent.get("max_budget")
        if max_budget is not None and p_price > max_budget:
            return False, [f"Price ₹{p_price:,.0f} exceeds authorized budget ₹{max_budget:,.0f}."]

        # 4. Product Type Match (Strict)
        req_type = intent.get("product_type")
        if req_type:
            matches_type = False
            if req_type == "power_bank":
                matches_type = p_type == "power_bank" or "power bank" in p_name or "powerbank" in p_name or "powercore" in p_name
            elif req_type == "headphones":
                matches_type = p_type == "headphones" or "headphone" in p_name or "wh-1000xm5" in p_name or "quietcomfort" in p_name or "accentum" in p_name
            elif req_type == "laptop":
                matches_type = p_type == "laptop" or "laptop" in p_name or "macbook" in p_name or "tuf" in p_name or "zephyrus" in p_name or "xps" in p_name
            elif req_type == "monitor":
                matches_type = p_type == "monitor" or "monitor" in p_name or "display" in p_name or "ultrasharp" in p_name or "ultrafine" in p_name
            elif req_type == "mouse":
                matches_type = p_type == "mouse" or "mouse" in p_name or "mx master" in p_name
            elif req_type == "keyboard":
                matches_type = p_type == "keyboard" or "keyboard" in p_name or "keychron" in p_name
            elif req_type == "chair":
                matches_type = p_type == "chair" or "chair" in p_name or "aeron" in p_name
            elif req_type == "desk":
                matches_type = p_type == "desk" or "desk" in p_name
            else:
                matches_type = p_type == req_type or req_type in p_name or req_type in p_cat

            if not matches_type:
                return False, [f"Requested '{req_type}', but product is '{p_type or 'other'}' ({product.get('name')})."]

        # 5. Capacity Check (e.g. 20,000mAh)
        req_cap = intent.get("required_capacity_mah")
        if req_cap:
            actual_cap = None
            if "capacity_mah" in p_specs:
                try: actual_cap = int(p_specs["capacity_mah"])
                except Exception: pass
            elif "capacity" in p_specs:
                m = re.search(r'(\d{4,6})', str(p_specs["capacity"]))
                if m: actual_cap = int(m.group(1))
            if not actual_cap:
                m = re.search(r'(\d{4,6})\s*mah', p_name)
                if m: actual_cap = int(m.group(1))

            if not actual_cap or actual_cap < req_cap:
                return False, [f"Battery capacity ({actual_cap or 'unknown'}mAh) does not meet >= {req_cap}mAh."]

        # 6. RAM Check
        req_ram = intent.get("required_ram_gb")
        if req_ram:
            actual_ram = None
            if "ram" in p_specs:
                m = re.search(r'(\d{1,3})\s*gb', str(p_specs["ram"]), re.IGNORECASE)
                if m: actual_ram = int(m.group(1))
            if not actual_ram:
                m = re.search(r'(\d{1,3})\s*gb\s*ram', p_name, re.IGNORECASE)
                if m: actual_ram = int(m.group(1))

            if not actual_ram or actual_ram < req_ram:
                return False, [f"Memory ({actual_ram or 'unknown'}GB) does not meet >= {req_ram}GB."]

        # 7. ANC Check
        if intent.get("required_anc"):
            has_anc = bool(p_specs.get("anc") or "anc" in p_name or "noise cancel" in p_name)
            if not has_anc:
                return False, ["Active Noise Cancellation (ANC) required but not supported."]

        return True, ["All hard constraints verified."]

    async def process_request(
        self,
        message: str,
        agent_id: Optional[str] = None,
        user_id: Optional[str] = "default",
    ) -> ChatResponse:
        tools_called = ["search_authoritative_catalog", "evaluate_hard_constraints"]
        
        # 1. Threat check on user input
        guard_res = PromptInjectionGuard.detect_injection_threat(message)
        
        # 2. Parse intent & extract hard constraints
        intent_data = self.parse_user_intent(message)
        quantity = intent_data.get("quantity", 1)
        max_budget = intent_data.get("max_budget")
        
        # 3. Discover matching products across authoritative catalog
        all_products = await self.tools.search_products(limit=50)

        # 4. Strict Hard Constraint Filtering (NO Fallbacks Allowed)
        eligible_candidates = []
        for p in all_products:
            is_valid, reasons = self.evaluate_candidate_eligibility(p, intent_data)
            if is_valid:
                eligible_candidates.append(p)

        # Sort by price ascending
        eligible_candidates.sort(key=lambda x: float(x.get("price", 0)))
        matching_product = eligible_candidates[0] if eligible_candidates else None

        # 5. Resolve effective agent_id
        effective_agent_id = agent_id
        agent_name = "Procurement Agent"
        if effective_agent_id:
            agent_details = await self.tools.get_agent_details(effective_agent_id)
            if agent_details:
                agent_name = agent_details.get("name", "Procurement Agent")
        else:
            async with httpx.AsyncClient(timeout=5.0) as client:
                try:
                    res = await client.get(f"{self.tools.base_url}/agents")
                    if res.status_code == 200:
                        agents = res.json().get("agents", [])
                        proc = next((a for a in agents if "Procurement" in a.get("name", "")), agents[0] if agents else None)
                        if proc:
                            effective_agent_id = proc.get("id")
                            agent_name = proc.get("name", "Procurement Agent")
                except Exception:
                    pass

        if not matching_product:
            return ChatResponse(
                status="NO_MATCH",
                agent_name=agent_name,
                reply=f"I couldn't find an in-stock product that matches all of your explicit requirements for '{message}'.",
                intent_parsed=intent_data,
                authorization_status=AuthorizationStatus(
                    state="NO_MATCH",
                    explanation="No product in authoritative merchant catalogs satisfies 100% of hard constraints.",
                    policy_summary="No policy evaluation needed.",
                ),
                tools_called=tools_called,
            )

        # 6. Build Structured Recommendation & Comparison
        unit_price = float(matching_product.get("price", 0))
        total_amount = unit_price * quantity
        prod_id = matching_product.get("id")
        prod_name = matching_product.get("name")
        merchant_name = matching_product.get("merchant_name", "Verified Merchant")
        merchant_id = matching_product.get("merchant_id")

        reason_text = f"Top-ranked match for your specifications ({', '.join(intent_data['constraints']) or 'all criteria'}) at ₹{unit_price:,.0f}."
        if quantity > 1:
            reason_text = f"Selected {quantity} units of '{prod_name}' at ₹{unit_price:,.0f}/unit (Total: ₹{total_amount:,.0f})."

        recommendation = ProductRecommendation(
            product_id=prod_id,
            name=f"{quantity}x {prod_name}" if quantity > 1 else prod_name,
            price=total_amount,
            merchant_name=merchant_name,
            reason=reason_text,
            specifications=matching_product.get("specifications") or {},
        )

        proposed_action = ProposedAction(
            type="CREATE_PURCHASE_INTENT",
            product_id=prod_id,
            product_name=recommendation.name,
            amount=total_amount,
            merchant_id=merchant_id,
            merchant_name=merchant_name,
        )

        # 7. Submit to Backend Policy Decision Engine
        purchase_intent_record = None
        evaluation_record = None
        
        if effective_agent_id:
            tools_called.append("create_purchase_intent")
            intent_res = await self.tools.create_purchase_intent(
                agent_id=effective_agent_id,
                product_id=prod_id,
                amount=total_amount,
                merchant_id=merchant_id,
                user_id=user_id,
                ai_reasoning=f"AI Agent selected '{recommendation.name}' for ₹{total_amount:,.0f} matching user criteria: {message}",
                ai_recommendation=recommendation.reason,
            )
            purchase_intent_record = intent_res.get("purchaseIntent")
            evaluation_record = intent_res.get("evaluation")

        decision_state = "AWAITING_POLICY_EVALUATION"
        auth_explanation = f"I found the {prod_name} for ₹{total_amount:,.0f}. I have structured a purchase intent, which will now be evaluated deterministically by the AgentPay policy engine."
        
        if evaluation_record:
            dec = evaluation_record.get("decision")
            if dec == "ALLOW":
                decision_state = "ALLOWED"
                auth_explanation = f"AgentPay Policy Engine evaluated and ALLOWED this purchase (₹{total_amount:,.0f} within autonomous limit). Razorpay test order can now be generated."
            elif dec == "APPROVAL_REQUIRED":
                decision_state = "APPROVAL_REQUIRED"
                actual_threshold = evaluation_record.get("policyResult", {}).get("threshold") or evaluation_record.get("threshold") or 50000
                auth_explanation = f"AgentPay Policy Engine requires HUMAN APPROVAL (Amount ₹{total_amount:,.0f} exceeds autonomous spending threshold of ₹{actual_threshold:,.0f}). Routed to Approval Center."
            elif dec == "BLOCK":
                decision_state = "BLOCKED"
                auth_explanation = f"AgentPay Policy Engine BLOCKED this transaction: {evaluation_record.get('reason')}."

        reply_text = (
            f"I found the **{prod_name}** from *{merchant_name}* for **₹{total_amount:,.0f}**" + (f" ({quantity} units @ ₹{unit_price:,.0f}/unit)" if quantity > 1 else "") + " that satisfies your requirements.\n\n"
            f"**Recommendation Analysis:** {recommendation.reason}\n\n"
            f"**AgentPay Control Plane:** {auth_explanation}"
        )

        return ChatResponse(
            status="MATCH_FOUND",
            agent_name=agent_name,
            reply=reply_text,
            intent_parsed=intent_data,
            recommendation=recommendation,
            proposed_action=proposed_action,
            authorization_status=AuthorizationStatus(
                state=decision_state,
                explanation=auth_explanation,
                policy_summary="Deterministic spending policies evaluated server-side. LLM has zero direct payment authority.",
            ),
            tools_called=tools_called,
            purchase_intent=purchase_intent_record,
            evaluation=evaluation_record,
        )
