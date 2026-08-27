from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from models.schemas import ChatRequest, ChatResponse
from agent.buyer_agent import AIBuyerAgent
from agent.memory import AgentSafeMemory
from agent.tools import AgentTools

app = FastAPI(
    title="AgentPay AI Service",
    description="Autonomous AI Buyer Agent & Tool-Calling Service for AgentPay Control Plane",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Agent components
tools = AgentTools(base_url=settings.BACKEND_API_URL)
memory = AgentSafeMemory()
agent = AIBuyerAgent(tools=tools, memory=memory)

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "AgentPay AI Service",
        "version": "1.0.0",
        "port": settings.PORT,
    }

@app.post("/chat", response_model=ChatResponse)
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

@app.get("/memory/{user_id}")
async def get_preferences(user_id: str):
    return memory.get_user_preferences(user_id)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.PORT)
