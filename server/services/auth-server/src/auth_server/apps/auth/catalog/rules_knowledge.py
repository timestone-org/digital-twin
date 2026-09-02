"""闸 1 对 `/api/v1/knowledge` 的规则。

⚠ 三个码按「读 / 写内容 / 管库」分档，而闸 1 的规则按 **路径 + 方法**匹配。
所以写与管各有自己的路径段，且**端点先落地、码再登记**——反过来的话，那个码
没有任何规则要它，在角色配置界面上就是一个点了没效果的勾。

⚠ 建库删库走 `POST/DELETE /knowledge-bases*` 要 manage，而 `GET` 只要 use：
同一段路径按方法分档，这正是闸 1 表达得了的形状。
"""

from auth_server.apps.auth.catalog.permissions import (
    KNOWLEDGE_MANAGE,
    KNOWLEDGE_USE,
    KNOWLEDGE_WRITE,
)
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
    RouteRuleSpec(
        f"{_K}/knowledge-bases",
        "GET",
        codes=(KNOWLEDGE_USE,),
        priority=890,
        description="列知识库",
    ),
    RouteRuleSpec(
        f"{_K}/knowledge-bases/*",
        "GET",
        codes=(KNOWLEDGE_USE,),
        priority=890,
        description="库详情与它下面的来源",
    ),
    RouteRuleSpec(
        f"{_K}/knowledge-bases*",
        "*",
        codes=(KNOWLEDGE_MANAGE,),
        priority=880,
        description=(
            "建库删库、配来源。⚠ 比读严一档：改嵌入档等于让整库的既有向量"
            "作废，而那件事没有任何运行期迹象"
        ),
    ),
    RouteRuleSpec(
        f"{_K}/sources/*",
        "*",
        codes=(KNOWLEDGE_WRITE,),
        priority=880,
        description=(
            "跑一次来源同步。⚠ 与建库配来源分档：能把外部记录摄进来"
            "不等于能改来源配置——前者用的是调用者自己的身份去打上游，"
            "后者决定的是**去打哪里**"
        ),
    ),
    RouteRuleSpec(
        f"{_K}/chat-sessions*",
        "*",
        codes=(KNOWLEDGE_USE,),
        priority=890,
        description=(
            "知识库对话：会话的列建看改删与推进一个回合。⚠ 只要 use，与检索"
            "同一个码：能检索就能问，问不出比检索更多的东西——对话面只读，"
            "模型手上一个写工具都没有（docs/KNOWLEDGE_CHAT_DESIGN.md §6）"
        ),
    ),
    RouteRuleSpec(
        f"{_K}/documents",
        "GET",
        codes=(KNOWLEDGE_USE,),
        priority=890,
        description="列文档",
    ),
    RouteRuleSpec(
        f"{_K}/documents/*",
        "GET",
        codes=(KNOWLEDGE_USE,),
        priority=890,
        description="文档详情",
    ),
    RouteRuleSpec(
        f"{_K}/documents*",
        "*",
        codes=(KNOWLEDGE_WRITE,),
        priority=880,
        description=(
            "传文档、删文档、重新解析。⚠ 与建库删库分档：能往库里加东西"
            "不等于能建库，也不等于能改嵌入档"
        ),
    ),
)

__all__ = ["KNOWLEDGE_RULES"]
