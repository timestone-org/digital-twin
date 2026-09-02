"""对话面的路由。"""

from knowledge_server.apps.chat.api import advance, sessions

CHAT_ROUTERS = (sessions.router, advance.router)

__all__ = ["CHAT_ROUTERS"]
