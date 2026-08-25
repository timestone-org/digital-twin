"""闸 1 对 `/api/v1/assistant` 的规则。

⚠ 事件流那条走的是普通 HTTP POST，闸 1 照常认得出它——与 realtime 的 WebSocket
不同，那一条因为凭据在子协议里而必须免认证放行。这里没有那个问题。
"""

from auth_server.apps.auth.catalog.permissions import ASSISTANT_USE
from auth_server.apps.auth.catalog.specs import RouteRuleSpec

_A = "/api/v1/assistant"

ASSISTANT_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(f"{_A}/health", "GET", priority=999, description="存活探针"),
    RouteRuleSpec(f"{_A}/ready", "GET", priority=999, description="就绪探针"),
    RouteRuleSpec(f"{_A}/docs", "GET", priority=998, description="文档"),
    RouteRuleSpec(f"{_A}/redoc", "GET", priority=998, description="文档"),
    RouteRuleSpec(
        f"{_A}/openapi.json", "GET", priority=998, description="契约"
    ),
    RouteRuleSpec(
        f"{_A}/capabilities",
        "GET",
        codes=(ASSISTANT_USE,),
        priority=900,
        description=(
            "能力探测。前端靠它决定摆不摆助手入口——"
            "没有这个码的账号连问都不会问"
        ),
    ),
    RouteRuleSpec(
        f"{_A}/sessions/*",
        "*",
        codes=(ASSISTANT_USE,),
        priority=890,
        description=(
            "会话读写与推进回合。⚠ 看不见的会话一律 404 而不是 403："
            "403 等于逐个 id 回答「这条对话确实存在」，而会话 id 拿得到就能试"
        ),
    ),
    RouteRuleSpec(
        f"{_A}/sessions",
        "*",
        codes=(ASSISTANT_USE,),
        priority=890,
        description="会话列表与新建",
    ),
    RouteRuleSpec(
        f"{_A}/attachments*",
        "*",
        codes=(ASSISTANT_USE,),
        priority=890,
        description=(
            "解析上传的点表。⚠ 它不存文件——读完就把内容交给调用方，"
            "所以这里没有「谁能读回来」那一档判定"
        ),
    ),
    RouteRuleSpec(
        f"{_A}/skills",
        "GET",
        codes=(ASSISTANT_USE,),
        priority=890,
        description="这套部署装了哪些技能",
    ),
)

__all__ = ["ASSISTANT_RULES"]
