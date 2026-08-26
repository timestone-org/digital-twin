"""凭据面的路由。"""

from ai_assistant.apps.credential.api import credentials

ROUTERS = (credentials.router,)

__all__ = ["ROUTERS"]
