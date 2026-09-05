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

    async def search_products(
        self,
        query: Optional[str] = None,
        category: Optional[str] = None,
        max_price: Optional[float] = None,
        min_price: Optional[float] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        headers = {}
        if getattr(settings, "INTERNAL_TOKEN", None):
            headers["x-agentpay-internal-token"] = settings.INTERNAL_TOKEN

        # 1. Prefer authoritative /api/ai/catalog (agentpay.catalog.v1)
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                params = {"limit": limit, "inStockOnly": "true"}
                if query:
                    params["search"] = query
                if category:
                    params["category"] = category
                if max_price:
                    params["maxPrice"] = max_price
                if min_price:
                    params["minPrice"] = min_price

                res = await client.get(f"{self.base_url}/ai/catalog", params=params, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    items = data.get("items", [])
                    if items:
                        return [self.normalize_catalog_item(item) for item in items]
            except Exception as e:
                print(f"[AgentTools] AI Catalog search error, falling back to /products: {e}")

            # 2. Resilient fallback to /products
            try:
                p_params = {"limit": limit, "in_stock": "true"}
                if query:
                    p_params["search"] = query
                if category:
                    p_params["category"] = category
                if max_price:
                    p_params["max_price"] = max_price
                if min_price:
                    p_params["min_price"] = min_price

                res = await client.get(f"{self.base_url}/products", params=p_params, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    products = data.get("products", [])
                    return [self.normalize_catalog_item(p) for p in products]
            except Exception as e:
                print(f"[AgentTools] Products search error: {e}")

        return []

    async def get_product(self, product_id: str) -> Optional[Dict[str, Any]]:
        headers = {}
        if getattr(settings, "INTERNAL_TOKEN", None):
            headers["x-agentpay-internal-token"] = settings.INTERNAL_TOKEN

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                res = await client.get(f"{self.base_url}/ai/catalog/{product_id}", headers=headers)
                if res.status_code == 200:
                    return self.normalize_catalog_item(res.json())
            except Exception as e:
                print(f"[AgentTools] AI Catalog get product error: {e}")

            try:
                res = await client.get(f"{self.base_url}/products/{product_id}", headers=headers)
                if res.status_code == 200:
                    p = res.json().get("product")
                    return self.normalize_catalog_item(p) if p else None
            except Exception as e:
                print(f"[AgentTools] Products get product error: {e}")

        return None

    async def compare_products(self, product_ids: List[str]) -> List[Dict[str, Any]]:
        if not product_ids:
            return []
        ids_str = ",".join(product_ids)
        headers = {}
        if getattr(settings, "INTERNAL_TOKEN", None):
            headers["x-agentpay-internal-token"] = settings.INTERNAL_TOKEN

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                res = await client.get(f"{self.base_url}/products/compare", params={"ids": ids_str}, headers=headers)
                if res.status_code == 200:
                    products = res.json().get("products", [])
                    return [self.normalize_catalog_item(p) for p in products]
            except Exception as e:
                print(f"[AgentTools] Compare error: {e}")
        return []

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

