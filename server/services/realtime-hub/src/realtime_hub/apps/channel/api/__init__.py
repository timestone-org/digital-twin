"""路由注册表。app.py 只认这一个名字。"""

from realtime_hub.apps.channel.api import internal, ws

ROUTERS = (ws.router, internal.router)

__all__ = ["ROUTERS"]
