import secrets
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from models.schemas import ChatRequest, ChatResponse
from agent.buyer_agent import AIBuyerAgent
from agent.memory import AgentSafeMemory
from agent.tools import AgentTools

# ─── Startup security gate ───────────────────────────────────────────────────
# In production a missing internal token previously meant "allow everyone"
# (require_internal_token returned True when no token was configured). This
# service can drive the buyer agent, so an unauthenticated deployment is not an
# acceptable degraded mode. Refuse to start instead.
if settings.is_production and not (settings.AI_SERVICE_INTERNAL_TOKEN or settings.INTERNAL_TOKEN):
    raise RuntimeError(
        "FATAL: AI_SERVICE_INTERNAL_TOKEN is not configured but APP_ENV is production. "
        "The AgentPay AI service refuses to start unauthenticated. Set "
        "AI_SERVICE_INTERNAL_TOKEN to the same value the backend sends."
    )

app = FastAPI(
    title="AgentPay AI Service",
    description="Autonomous AI Buyer Agent & Tool-Calling Service for AgentPay Control Plane",
    version="1.0.0",
    # Interactive docs are not exposed in production for an internal service.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

# CORS: this is an INTERNAL service reached server-to-server by the AgentPay
# backend, so no browser origin needs access. The previous
# allow_origins=["*"] + allow_credentials=True combination is both invalid per
# the CORS spec and, where a browser honours it, lets any site issue credentialed
# requests to the agent. Middleware is only mounted when an operator has
# explicitly allowlisted origins.
if settings.ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["POST", "GET"],
        allow_headers=["Authorization", "Content-Type", "X-AgentPay-Internal-Token"],
    )

# Initialize Agent components
tools = AgentTools(base_url=settings.BACKEND_API_URL)
memory = AgentSafeMemory()
agent = AIBuyerAgent(tools=tools, memory=memory)

def require_internal_token(
    authorization: Optional[str] = Header(default=None),
    x_agentpay_internal_token: Optional[str] = Header(default=None),
    x_internal_token: Optional[str] = Header(default=None),
):
    expected = settings.AI_SERVICE_INTERNAL_TOKEN or settings.INTERNAL_TOKEN
    if not expected:
        # Fail closed. Previously this returned True — "no token configured"
        # meant "no authentication required", which is the wrong default for a
        # service that can drive an autonomous buyer. Production cannot reach
        # here at all (startup aborts above); in development the request is
        # refused with an actionable message rather than silently allowed.
        raise HTTPException(
            status_code=503,
            detail=(
                "AI service is not configured for authenticated access: "
                "AI_SERVICE_INTERNAL_TOKEN is unset. Requests are refused."
            ),
        )

    presented = x_agentpay_internal_token or x_internal_token or ""
    if authorization and authorization.lower().startswith("bearer "):
        presented = authorization.split(" ", 1)[1].strip()

    if not secrets.compare_digest(presented, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")

    return True

@app.get("/health")
async def health_check():
    gemini_configured = bool(settings.GEMINI_API_KEY and settings.GEMINI_MODEL and agent.model is not None)
    return {
        "status": "healthy",
        "service": "AgentPay AI Service",
        "version": "1.0.0",
        "port": settings.PORT,
        "gemini": {
            "configured": gemini_configured,
            "model": settings.GEMINI_MODEL if gemini_configured else None,
        },
        "fallback_mode": "deterministic_catalog_grounding",
    }

@app.post("/chat", response_model=ChatResponse, dependencies=[Depends(require_internal_token)])
async def chat_with_agent(req: ChatRequest):
    try:
        response = await agent.process_request(
            message=req.message,
            agent_id=req.agent_id,
            user_id=req.user_id or "default",
        )
        return response
    except Exception as e:
        print(f"[AI Service Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/memory/{user_id}", dependencies=[Depends(require_internal_token)])
async def get_preferences(user_id: str):
    return memory.get_user_preferences(user_id)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.PORT)
