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
        description=(
            "WebSocket 端点。任意已登录用户可连；拿着公开令牌的匿名访客同样"
            "可连（ADR-0021），它能订的只有那枚令牌换来的一个别名主题。"
            "能收到什么由每个主题声明的码"
            "另判：`opcua:*` 的主题声明 `opcua:view`，大屏主题声明"
            " `dashboard:view`，hub 在登记主题时校验那个码在本目录里，"
            "码没登记则主题登记不上、整条推送链路是哑的。"
            "给连接本身另设一道码就是 ADR-0007 否掉的第二处判断，而且它挡不住"
            "任何东西：连上来却订不到任何主题的连接，一个字节也拿不到。"
            "⚠ token 走子协议而不是 Authorization 头，闸 1 认不出它——"
            "匿名可达性必须由边缘免认证 location 保证，认证在 hub 内部完成"
        ),
    ),
)
