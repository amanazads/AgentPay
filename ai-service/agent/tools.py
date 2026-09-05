# pyrefly: ignore [missing-import]
import httpx
from typing import List, Dict, Any, Optional
from config import settings

class AgentTools:
    """
    Standardized discovery tools for the AI Buyer Agent.
    Note: The AI agent ONLY has access to discovery and comparison tools.
    Direct financial execution, policy modification, or approval bypass tools are PROHIBITED.
    """
    
    def __init__(self, base_url: str = settings.BACKEND_API_URL):
        self.base_url = base_url

    @staticmethod
    def normalize_catalog_item(item: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalizes both /api/ai/catalog (agentpay.catalog.v1) and /api/products
        into a canonical dictionary for deterministic hard-constraint evaluation.
        """
        pricing = item.get("pricing", {})
        inventory = item.get("inventory", {})
        merchant = item.get("merchant", {})
        ai_metadata = item.get("aiMetadata", {})

        prod_id = item.get("productId") or item.get("id")
        name = item.get("title") or item.get("name") or ""
        price = pricing.get("amount") if isinstance(pricing, dict) and "amount" in pricing else item.get("price", 0)
        in_stock = inventory.get("inStock") if isinstance(inventory, dict) and "inStock" in inventory else item.get("in_stock", True)
        inv_qty = inventory.get("quantity") if isinstance(inventory, dict) and "quantity" in inventory else item.get("inventory", 0)
        specs = item.get("specificationsNormalized") or item.get("specifications") or {}
        merchant_id = merchant.get("id") if isinstance(merchant, dict) and "id" in merchant else item.get("merchant_id")
        merchant_name = merchant.get("name") if isinstance(merchant, dict) and "name" in merchant else item.get("merchant_name", "Verified Merchant")

        prod_type = item.get("product_type") or item.get("productType") or item.get("product_category") or ""

        return {
            "id": prod_id,
            "productId": prod_id,
            "name": name,
            "title": name,
            "price": float(price or 0),
            "unit_price": float(price or 0),
            "currency": pricing.get("currency") if isinstance(pricing, dict) else item.get("currency", "INR"),
            "category": item.get("category", ""),
            "product_type": prod_type,
            "brand": item.get("brand", ""),
            "description": item.get("description", ""),
            "in_stock": bool(in_stock),
            "inventory": int(inv_qty or 0),
            "specifications": specs,
            "merchant_id": merchant_id,
            "merchant_name": merchant_name,
            "is_test_lab": item.get("is_test_lab", False),
            "ai_metadata": ai_metadata,
        }

    class DiscoveryUnavailable(Exception):
        """
        Raised when the authoritative AI catalog cannot be reached.

        This is deliberately NOT swallowed into an empty result list. An empty
        list is indistinguishable from "no products match", which would let a
        catalog outage masquerade as a legitimate NO_MATCH. Callers must render
        a discovery-unavailable state instead.
        """

    async def search_products(
        self,
        query: Optional[str] = None,
        category: Optional[str] = None,
        product_type: Optional[str] = None,
        brand: Optional[str] = None,
        max_price: Optional[float] = None,
        min_price: Optional[float] = None,
        limit: int = 200,
        max_pages: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Searches the AUTHORITATIVE agentic catalog with real query parameters
        and pages until the result set is exhausted (or max_pages is hit).

        Two deliberate behaviours:

        1. NO FALLBACK TO /api/products. That endpoint is the generic storefront
           catalog and does not apply the AI commerce eligibility boundary, so
           it can expose test-lab, inactive and commerce-ineligible products.
           Falling back to it silently traded correctness for availability. If
           /api/ai/catalog is unavailable we raise DiscoveryUnavailable.

        2. The query is actually passed to the server. The previous caller
           fetched a generic first page of 50 products and filtered locally,
           which is why arbitrary product searches failed: the requested item
           was frequently not in the first page at all.
        """
        headers = {}
        if getattr(settings, "INTERNAL_TOKEN", None):
            headers["x-agentpay-internal-token"] = settings.INTERNAL_TOKEN

        page_size = max(1, min(int(limit or 200), 200))
        collected: List[Dict[str, Any]] = []
        offset = 0
        last_error: Optional[Exception] = None

        async with httpx.AsyncClient(timeout=10.0) as client:
            for _ in range(max(1, int(max_pages))):
                params: Dict[str, Any] = {"limit": page_size, "offset": offset}
                if query:
                    params["search"] = query
                if category:
                    params["category"] = category
                if product_type:
                    params["productType"] = product_type
                if brand:
                    params["brand"] = brand
                if max_price:
                    params["maxPrice"] = max_price
                if min_price:
                    params["minPrice"] = min_price

                try:
                    res = await client.get(f"{self.base_url}/ai/catalog", params=params, headers=headers)
                except Exception as e:  # network / connection failure
                    last_error = e
                    break

                if res.status_code != 200:
                    last_error = RuntimeError(
                        f"AI catalog returned HTTP {res.status_code}"
                    )
                    break

                data = res.json()
                items = data.get("items", []) or []
                collected.extend(self.normalize_catalog_item(item) for item in items)

                if not data.get("hasMore") or not items:
                    return collected

                offset += len(items)

            if last_error is not None and not collected:
                raise self.DiscoveryUnavailable(
                    f"Authoritative AI catalog is unavailable: {last_error}"
                )

        return collected

    async def get_product(self, product_id: str) -> Optional[Dict[str, Any]]:
        headers = {}
        if getattr(settings, "INTERNAL_TOKEN", None):
            headers["x-agentpay-internal-token"] = settings.INTERNAL_TOKEN

        async with httpx.AsyncClient(timeout=10.0) as client:
            # Authoritative catalog ONLY. The /api/products fallback that used to
            # live here does not apply the AI commerce eligibility boundary, so
            # it could hand back a test-lab, inactive or ineligible product that
            # the list endpoint would never have surfaced.
            try:
                res = await client.get(f"{self.base_url}/ai/catalog/{product_id}", headers=headers)
                if res.status_code == 200:
                    return self.normalize_catalog_item(res.json())
                if res.status_code == 404:
                    # Not in the AI catalog means not eligible. That is an answer,
                    # not an error, and it must not be worked around.
                    return None
                raise self.DiscoveryUnavailable(
                    f"AI catalog returned HTTP {res.status_code} for product {product_id}"
                )
            except self.DiscoveryUnavailable:
                raise
            except Exception as e:
                raise self.DiscoveryUnavailable(
                    f"Authoritative AI catalog is unavailable: {e}"
                ) from e

    async def compare_products(self, product_ids: List[str]) -> List[Dict[str, Any]]:
        """
        Compares products through the authoritative AI catalog only.

        Previously this called /api/products/compare, which applies no AI
        commerce eligibility boundary — a comparison table could therefore
        include products the buyer is not permitted to transact. Each id is now
        resolved through get_product(), which enforces the same boundary as the
        list endpoint; ineligible ids simply drop out of the comparison.
        """
        if not product_ids:
            return []

        compared: List[Dict[str, Any]] = []
        for pid in product_ids:
            try:
                product = await self.get_product(pid)
            except self.DiscoveryUnavailable:
                raise
            if product:
                compared.append(product)
        return compared

    async def get_agent_details(self, agent_id: str) -> Optional[Dict[str, Any]]:
        headers = {}
        if getattr(settings, "INTERNAL_TOKEN", None):
            headers["x-agentpay-internal-token"] = settings.INTERNAL_TOKEN

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                res = await client.get(f"{self.base_url}/agents/{agent_id}", headers=headers)
                if res.status_code == 200:
                    return res.json().get("agent")
            except Exception as e:
                print(f"[AgentTools] Get agent error: {e}")
        return None

