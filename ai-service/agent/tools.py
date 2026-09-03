import httpx
from typing import List, Dict, Any, Optional
from config import settings

class AgentTools:
    """
    Standardized tools for the AI Buyer Agent.
    Note: The AI agent ONLY has access to discovery and comparison tools.
    Direct financial execution, policy modification, or approval bypass tools are PROHIBITED.
    """
    
    def __init__(self, base_url: str = settings.BACKEND_API_URL):
        self.base_url = base_url

    async def search_products(
        self,
        query: Optional[str] = None,
        category: Optional[str] = None,
        max_price: Optional[float] = None,
        min_price: Optional[float] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        params = {"limit": limit}
        if query:
            params["search"] = query
        if category:
            params["category"] = category
        if max_price:
            params["max_price"] = max_price
        if min_price:
            params["min_price"] = min_price

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                res = await client.get(f"{self.base_url}/products", params=params)
                if res.status_code == 200:
                    data = res.json()
                    return data.get("products", [])
            except Exception as e:
                print(f"[AgentTools] Search error: {e}")
        return []

    async def get_product(self, product_id: str) -> Optional[Dict[str, Any]]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                res = await client.get(f"{self.base_url}/products/{product_id}")
                if res.status_code == 200:
                    return res.json().get("product")
            except Exception as e:
                print(f"[AgentTools] Get product error: {e}")
        return None

    async def compare_products(self, product_ids: List[str]) -> List[Dict[str, Any]]:
        if not product_ids:
            return []
        ids_str = ",".join(product_ids)
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                res = await client.get(f"{self.base_url}/products/compare", params={"ids": ids_str})
                if res.status_code == 200:
                    return res.json().get("products", [])
            except Exception as e:
                print(f"[AgentTools] Compare error: {e}")
        return []

    async def get_agent_details(self, agent_id: str) -> Optional[Dict[str, Any]]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                res = await client.get(f"{self.base_url}/agents/{agent_id}")
                if res.status_code == 200:
                    return res.json().get("agent")
            except Exception as e:
                print(f"[AgentTools] Get agent error: {e}")
        return None
