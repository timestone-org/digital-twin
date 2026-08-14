"""闸 1 对 `/api/v1/opcua` 的规则。

⚠ 顺序即语义：首条命中即终局，且 `*` 跨斜杠。动作端点必须排在前缀兜底
之前，否则 `:start` 会先命中 `instances*` 的读规则而被拒。
"""

from auth_server.apps.auth.catalog.permissions import (
    OPCUA_MANAGE,
    OPCUA_OPERATE,
    OPCUA_VIEW,
)
from auth_server.apps.auth.catalog.specs import RouteRuleSpec

_O = "/api/v1/opcua"

OPCUA_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(f"{_O}/health", "GET", priority=999, description="存活探针"),
    RouteRuleSpec(f"{_O}/ready", "GET", priority=999, description="就绪探针"),
    RouteRuleSpec(f"{_O}/docs", "GET", priority=998, description="文档"),
    RouteRuleSpec(f"{_O}/redoc", "GET", priority=998, description="文档"),
    RouteRuleSpec(
        f"{_O}/openapi.json", "GET", priority=998, description="契约"
    ),
    RouteRuleSpec(
        f"{_O}/instances/*:start",
        "POST",
        codes=(OPCUA_OPERATE,),
        priority=980,
        description="启动实例",
    ),
    RouteRuleSpec(
        f"{_O}/instances/*:stop",
        "POST",
        codes=(OPCUA_OPERATE,),
        priority=980,
        description="停止实例。⚠ 会断开该实例上全部上位机会话",
    ),
    RouteRuleSpec(
        f"{_O}/instances/*:restart",
        "POST",
        codes=(OPCUA_OPERATE,),
        priority=980,
        description="重启实例，同样断开全部会话",
    ),
    RouteRuleSpec(
        f"{_O}/instances/*:write",
        "POST",
        codes=(OPCUA_OPERATE,),
        priority=980,
        description="向节点写值，等于改变上位系统读到的数据",
    ),
    RouteRuleSpec(
        f"{_O}/instances/*/credentials*",
        "*",
        codes=(OPCUA_MANAGE,),
        priority=970,
        description="上位机接入凭据。⚠ 读面也要 manage：列表即暴露账号名",
    ),
    RouteRuleSpec(
        f"{_O}/instances/*/trusted-certificates*",
        "*",
        codes=(OPCUA_MANAGE,),
        priority=970,
        description="X509 信任白名单，决定哪台上位机连得进来",
    ),
    RouteRuleSpec(
        f"{_O}/instances*",
        "POST",
        codes=(OPCUA_MANAGE,),
        priority=960,
        description="建实例、建节点",
    ),
    RouteRuleSpec(
        f"{_O}/instances*",
        "PUT",
        codes=(OPCUA_MANAGE,),
        priority=960,
        description="改实例、改节点",
    ),
    RouteRuleSpec(
        f"{_O}/instances*",
        "DELETE",
        codes=(OPCUA_MANAGE,),
        priority=960,
        description="删实例、删节点",
    ),
    RouteRuleSpec(
        f"{_O}/instances*",
        "GET",
        codes=(OPCUA_VIEW,),
        priority=950,
        description="实例、节点、节点值、在线会话、端口池的全部读面",
    ),
)
