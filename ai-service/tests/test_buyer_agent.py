import pytest
from agent.buyer_agent import AIBuyerAgent

@pytest.fixture
def agent():
    return AIBuyerAgent()

def test_intent_parsing_phone_vs_headphones(agent):
    phone_query = "Order a phone under ₹80,000"
    parsed_phone = agent.parse_user_intent(phone_query)
    assert parsed_phone["product_type"] == "smartphone"
    assert parsed_phone["max_budget"] == 80000.0

    headphones_query = "Order Sony WH-1000XM5 headphones under ₹30,000"
    parsed_headphones = agent.parse_user_intent(headphones_query)
    assert parsed_headphones["product_type"] == "headphones"
    assert parsed_headphones["max_budget"] == 30000.0

    iphone_query = "Buy iPhone 15 Pro"
    parsed_iphone = agent.parse_user_intent(iphone_query)
    assert parsed_iphone["product_type"] == "smartphone"

def test_candidate_isolation_phone_cannot_match_headphones(agent):
    sony_headphones = {
        "id": "sony-wh1000xm5",
        "name": "Sony WH-1000XM5 Wireless Noise-Cancelling Headphones",
        "product_type": "headphones",
        "price": 26990,
        "in_stock": True,
    }
    iphone = {
        "id": "apple-iphone-15-pro",
        "name": "Apple iPhone 15 Pro (128GB, Natural Titanium)",
        "product_type": "smartphone",
        "price": 129900,
        "in_stock": True,
    }

    # Query 1: Phone under 80k
    intent_phone_80k = agent.parse_user_intent("Order a phone under ₹80,000")
    ok_sony, reasons_sony = agent.evaluate_candidate_eligibility(sony_headphones, intent_phone_80k)
    assert ok_sony is False
    assert any("Requested 'smartphone', but product is 'headphones'" in r for r in reasons_sony)

    ok_iphone_80k, reasons_iphone_80k = agent.evaluate_candidate_eligibility(iphone, intent_phone_80k)
    assert ok_iphone_80k is False
    assert any("exceeds authorized budget" in r for r in reasons_iphone_80k)

    # Query 2: Buy iPhone 15 Pro (no price cap)
    intent_iphone = agent.parse_user_intent("Buy iPhone 15 Pro")
    ok_iphone, _ = agent.evaluate_candidate_eligibility(iphone, intent_iphone)
    assert ok_iphone is True

    # Query 3: Buy Sony headphones under 30k
    intent_headphones = agent.parse_user_intent("Order Sony WH-1000XM5 headphones under ₹30,000")
    ok_sony_head, _ = agent.evaluate_candidate_eligibility(sony_headphones, intent_headphones)
    assert ok_sony_head is True
