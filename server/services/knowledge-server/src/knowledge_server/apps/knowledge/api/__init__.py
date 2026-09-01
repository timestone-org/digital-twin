"""对外路由。

⚠ 顺序即 openapi 里的顺序，也影响读代码的人先看到什么。能力面排在最前：
它是前端进这套知识库的第一道门，取不到它就什么都不摆。
"""

from knowledge_server.apps.knowledge.api import capabilities

ROUTERS = (capabilities.router,)

__all__ = ["ROUTERS"]
