import os
from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(dotenv_path=env_path)

class Settings:
    PORT: int = int(os.getenv("AI_SERVICE_PORT", "8000"))
    BACKEND_API_URL: str = os.getenv("BACKEND_API_URL", "http://localhost:5050/api")
    AI_SERVICE_INTERNAL_TOKEN: str = os.getenv("AI_SERVICE_INTERNAL_TOKEN", "").strip()
    GEMINI_API_KEY: str = (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "").strip()
    INTERNAL_TOKEN: str = os.getenv("AI_SERVICE_INTERNAL_TOKEN", "").strip()

    # Deployment environment. Production is strict: a missing internal token is
    # a startup failure rather than an open door.
    APP_ENV: str = (os.getenv("APP_ENV") or os.getenv("NODE_ENV") or "development").strip().lower()

    # This service is INTERNAL — it is called by the AgentPay backend, not by
    # browsers. Origins are therefore an explicit allowlist and empty by
    # default; wildcard CORS with credentials is never permitted.
    ALLOWED_ORIGINS: list = [
        o.strip() for o in (os.getenv("AI_SERVICE_ALLOWED_ORIGINS") or "").split(",") if o.strip()
    ]

    @property
    def is_production(self) -> bool:
        return self.APP_ENV in ("production", "prod")


settings = Settings()
