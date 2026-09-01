"""闸 1 对 `/api/v1/knowledge` 的规则。

⚠ 设计里的三个码按「读 / 写内容 / 管库」分档，而闸 1 的规则按 **路径 + 方法**
匹配。所以写与管要各有自己的路径段，且**端点先落地、码再登记**——反过来的话，
那个码没有任何规则要它，在角色配置界面上就是一个点了没效果的勾。
"""

from auth_server.apps.auth.catalog.permissions import KNOWLEDGE_USE
from auth_server.apps.auth.catalog.specs import RouteRuleSpec

_K = "/api/v1/knowledge"

KNOWLEDGE_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(f"{_K}/health", "GET", priority=999, description="存活探针"),
    RouteRuleSpec(f"{_K}/ready", "GET", priority=999, description="就绪探针"),
    RouteRuleSpec(f"{_K}/docs", "GET", priority=998, description="文档"),
    RouteRuleSpec(f"{_K}/redoc", "GET", priority=998, description="文档"),
    RouteRuleSpec(
        f"{_K}/openapi.json", "GET", priority=998, description="契约"
    ),
    RouteRuleSpec(
        f"{_K}/capabilities",
        "GET",
        codes=(KNOWLEDGE_USE,),
        priority=900,
        description=(
            "能力探测。前端靠它决定摆不摆知识库入口，也靠它知道"
            "两路索引此刻走在哪一档上"
        ),
    ),
)

__all__ = ["KNOWLEDGE_RULES"]
