"""语音输入面的路由。"""

from knowledge_server.apps.speech.api import ws

SPEECH_ROUTERS = (ws.router,)

__all__ = ["SPEECH_ROUTERS"]
