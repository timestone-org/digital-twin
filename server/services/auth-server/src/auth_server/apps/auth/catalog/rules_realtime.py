"""闸 1 对 `/api/v1/realtime` 的规则。

⚠ 这一段一个权限码都不新增，这是 ADR-0007 第 3 条的直接后果：hub 的订阅
授权**只比一次**——用户持有的码是否包含主题声明的码，没有第二处判断。
"""

from auth_server.apps.auth.catalog.specs import RouteRuleSpec

_R = "/api/v1/realtime"

REALTIME_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(f"{_R}/health", "GET", priority=999, description="存活探针"),
    RouteRuleSpec(f"{_R}/ready", "GET", priority=999, description="就绪探针"),
    RouteRuleSpec(f"{_R}/docs", "GET", priority=998, description="文档"),
    RouteRuleSpec(f"{_R}/redoc", "GET", priority=998, description="文档"),
    RouteRuleSpec(
        f"{_R}/openapi.json", "GET", priority=998, description="契约"
    ),
    RouteRuleSpec(
        f"{_R}/ws",
        "GET",
        priority=990,
        # ⚠ 描述随规则下发到管理页，编辑保存要过入参的 255 字上限
        description=(
            "WebSocket 端点。任意已登录用户可连；持公开令牌的匿名访客同样"
            "可连（ADR-0021），只能订那枚令牌换来的别名主题。能收到什么由"
            "每个主题声明的码另判（ADR-0007），连接本身不另设码。"
            "⚠ token 走子协议，闸 1 认不出它：匿名可达性由边缘免认证"
            " location 保证，认证在 hub 内部完成"
        ),
    ),
)
