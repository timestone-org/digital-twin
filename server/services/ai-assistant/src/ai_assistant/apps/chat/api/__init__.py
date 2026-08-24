"""对外路由。"""

from ai_assistant.apps.chat.api import capabilities

ROUTERS = (capabilities.router,)

__all__ = ["ROUTERS"]
