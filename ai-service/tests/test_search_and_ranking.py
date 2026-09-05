"""
§1 / §17 — AI buyer search construction and deterministic ranking.

Two behaviours are pinned here:

  1. The parsed intent is actually turned into catalog query parameters. The
     agent used to call search_products(limit=50) with no arguments at all,
     fetching a generic first page and filtering locally — which is why
     arbitrary product searches failed whenever the requested item was not in
     that first page.

  2. Selection is by relevance, not by price. The agent used to sort eligible
     candidates by price ascending and take [0], so "buy a phone under ₹80,000"
     resolved to whatever cheap thing survived filtering.
"""

import pytest

from agent.buyer_agent import AIBuyerAgent
from agent.tools import AgentTools


@pytest.fixture
def agent():
    return AIBuyerAgent()


# ── Search-term construction ────────────────────────────────────────────────

def test_search_terms_prefer_explicit_model(agent):
    intent = agent.parse_user_intent("Buy Sony WH-1000XM5 headphones under ₹30,000")
    terms = agent.build_search_terms(intent)
    assert terms is not None
    assert "wh-1000xm5" in terms.lower()


def test_search_terms_fall_back_to_product_type(agent):
    intent = {"product_type": "power_bank", "hardConstraints": {}}
    assert agent.build_search_terms(intent) == "power bank"


def test_search_terms_none_when_nothing_specific(agent):
    intent = {"hardConstraints": {}}
    assert agent.build_search_terms(intent) is None


def test_search_terms_do_not_dump_the_whole_sentence(agent):
    intent = agent.parse_user_intent("I would really like to buy a nice power bank please")
    terms = agent.build_search_terms(intent)
    # Whatever we send, it must not be the entire raw sentence.
    assert terms is None or len(terms.split()) <= 4


# ── Deterministic ranking ───────────────────────────────────────────────────

def _product(**kw):
    base = {
        "id": kw.get("id", "p"),
        "name": kw.get("name", "Product"),
        "brand": kw.get("brand", ""),
        "product_type": kw.get("product_type", "smartphone"),
        "description": kw.get("description", ""),
        "price": kw.get("price", 10000),
        "inventory": kw.get("inventory", 10),
        "specifications": kw.get("specifications", {}),
        "merchant_verified": kw.get("merchant_verified", True),
        "merchant_rating": kw.get("merchant_rating", 4.5),
        "ai_metadata": kw.get("ai_metadata", {}),
    }
    return base


def test_cheapest_is_not_automatically_selected(agent):
    intent = agent.parse_user_intent("Buy iPhone 15 Pro")
    cheap_decoy = _product(id="decoy", name="Budget Android Phone", brand="Generic", price=8000)
    real_match = _product(id="real", name="iPhone 15 Pro", brand="Apple", price=134900)

    ranked = agent.rank_candidates([cheap_decoy, real_match], intent)
    assert ranked[0]["id"] == "real", "exact model match must outrank a cheaper decoy"


def test_exact_brand_match_outranks_cheaper_other_brand(agent):
    intent = {"product_type": "headphones", "brand": "Sony", "hardConstraints": {"requiredBrand": "Sony"}}
    cheap_other = _product(id="cheap", name="Budget Headphones", brand="Generic",
                           product_type="headphones", price=999)
    sony = _product(id="sony", name="Sony WH-1000XM5", brand="Sony",
                    product_type="headphones", price=26990)

    ranked = agent.rank_candidates([cheap_other, sony], intent)
    assert ranked[0]["id"] == "sony"


def test_price_still_breaks_ties_between_equal_candidates(agent):
    intent = {"product_type": "smartphone", "hardConstraints": {}}
    expensive = _product(id="expensive", name="Phone A", price=70000)
    cheaper = _product(id="cheaper", name="Phone A", price=50000)

    ranked = agent.rank_candidates([expensive, cheaper], intent)
    assert ranked[0]["id"] == "cheaper", "with everything else equal, price decides"


def test_verified_merchant_outranks_unverified_at_same_relevance(agent):
    intent = {"product_type": "smartphone", "hardConstraints": {}}
    unverified = _product(id="unverified", name="Phone A", price=50000,
                          merchant_verified=False, merchant_rating=2.0)
    verified = _product(id="verified", name="Phone A", price=50000,
                        merchant_verified=True, merchant_rating=4.9)

    ranked = agent.rank_candidates([unverified, verified], intent)
    assert ranked[0]["id"] == "verified"


def test_promotion_never_outranks_relevance(agent):
    intent = agent.parse_user_intent("Buy iPhone 15 Pro")
    promoted_decoy = _product(id="promoted", name="Sponsored Android Phone", brand="Generic",
                              price=9000, ai_metadata={"isPromoted": True})
    real_match = _product(id="real", name="iPhone 15 Pro", brand="Apple", price=134900)

    ranked = agent.rank_candidates([promoted_decoy, real_match], intent)
    assert ranked[0]["id"] == "real"


def test_ranking_is_stable_and_total(agent):
    intent = {"product_type": "smartphone", "hardConstraints": {}}
    products = [_product(id=f"p{i}", name="Phone", price=1000 * i) for i in range(1, 6)]
    ranked = agent.rank_candidates(products, intent)
    assert len(ranked) == len(products)
    assert {p["id"] for p in ranked} == {p["id"] for p in products}


def test_ranking_handles_empty_and_malformed_input(agent):
    assert agent.rank_candidates([], {}) == []
    weird = [{"id": "x"}, {"id": "y", "price": None, "merchant_rating": "not-a-number"}]
    ranked = agent.rank_candidates(weird, {"hardConstraints": {}})
    assert len(ranked) == 2


# ── Catalog fallback removal ────────────────────────────────────────────────

def test_discovery_unavailable_is_a_distinct_exception():
    """
    A catalog outage must not be indistinguishable from "nothing matched".
    Returning [] on failure let an outage masquerade as a legitimate NO_MATCH.
    """
    assert issubclass(AgentTools.DiscoveryUnavailable, Exception)


def test_tools_no_longer_reference_the_generic_products_endpoint():
    """
    /api/products applies no AI commerce eligibility boundary, so it can expose
    test-lab, inactive and commerce-ineligible products. It must not be used as
    a fallback for AI discovery.
    """
    import inspect
    source = inspect.getsource(AgentTools.search_products)
    assert "/products" not in source.replace("/api/products.", "")

    get_source = inspect.getsource(AgentTools.get_product)
    assert 'f"{self.base_url}/products/' not in get_source


# ── Category isolation in the Python parser ─────────────────────────────────

def test_quantum_computer_is_not_classified_as_a_laptop(agent):
    """
    'computer' used to be a laptop keyword, so an unrelated request became a
    laptop search — the exact silent category substitution that is forbidden.
    """
    parsed = agent.parse_user_intent("Find a quantum computer")
    assert parsed["product_type"] is None


def test_ambiguous_request_has_no_product_type(agent):
    parsed = agent.parse_user_intent("I need something for my office")
    assert parsed["product_type"] is None
