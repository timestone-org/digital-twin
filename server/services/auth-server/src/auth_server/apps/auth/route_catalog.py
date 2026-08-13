"""内置路由规则目录：闸 1（边缘 `auth_request`）按此表判放行，种子脚本全量写库。

权限码、内置角色与规格类在 `catalog.py`；「同批加码、加规则、加契约测试」的
约定见那边文件头。划分口径与三道闸见 ../../../CONTEXT.md。
"""

from auth_server.apps.auth.catalog import (
    AC_MANAGE,
    AC_VIEW,
    OPCUA_MANAGE,
    OPCUA_OPERATE,
    OPCUA_VIEW,
    ROLE_MANAGE,
    ROUTE_RULE_MANAGE,
    ROUTE_RULE_VIEW,
    USER_DELETE,
    USER_GRANT,
    USER_MANAGE,
    USER_VIEW,
    RouteRuleSpec,
)

_P = "/api/v1/auth"
_PLATFORM = "/api/v1/platform"
_O = "/api/v1/opcua"
_R = "/api/v1/realtime"

ROUTE_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(f"{_P}/health", "GET", priority=999, description="存活探针"),
    RouteRuleSpec(f"{_P}/ready", "GET", priority=999, description="就绪探针"),
    RouteRuleSpec(f"{_P}/docs", "GET", priority=998, description="文档"),
    RouteRuleSpec(f"{_P}/redoc", "GET", priority=998, description="文档"),
    RouteRuleSpec(
        f"{_P}/openapi.json", "GET", priority=998, description="契约"
    ),
    RouteRuleSpec(
        f"{_P}/sessions*",
        "*",
        priority=995,
        description="登录/刷新/登出。⚠ 匿名可达性由边缘免认证 location 保证",
    ),
    RouteRuleSpec(
        f"{_P}/registrations",
        "POST",
        priority=994,
        description="自助注册。⚠ 同上，需边缘免认证 location",
    ),
    RouteRuleSpec(
        f"{_P}/users/me*",
        "*",
        priority=992,
        description="个人资料自服务，任意登录用户，不要求权限码",
    ),
    RouteRuleSpec(
        f"{_P}/users/*:assign-role",
        "POST",
        codes=(USER_GRANT,),
        priority=971,
        description="改派角色",
    ),
    RouteRuleSpec(
        f"{_P}/users/*/permissions",
        "PUT",
        codes=(USER_GRANT,),
        priority=971,
        description="覆盖式写用户直权",
    ),
    RouteRuleSpec(
        f"{_P}/users*",
        "GET",
        codes=(USER_VIEW,),
        priority=965,
        description="用户列表与详情",
    ),
    RouteRuleSpec(
        f"{_P}/users",
        "POST",
        codes=(USER_MANAGE,),
        priority=965,
        description="创建用户",
    ),
    RouteRuleSpec(
        f"{_P}/users/*",
        "POST",
        codes=(USER_MANAGE,),
        priority=963,
        description="启停、重置他人密码",
    ),
    RouteRuleSpec(
        f"{_P}/users/*",
        "PATCH",
        codes=(USER_MANAGE,),
        priority=960,
        description="更新他人资料",
    ),
    RouteRuleSpec(
        f"{_P}/users/*",
        "DELETE",
        codes=(USER_DELETE,),
        priority=960,
        description="删除用户",
    ),
    RouteRuleSpec(
        f"{_P}/roles*",
        "GET",
        codes=(USER_VIEW,),
        priority=955,
        description="角色列表与详情",
    ),
    RouteRuleSpec(
        f"{_P}/roles*",
        "POST",
        codes=(ROLE_MANAGE,),
        priority=955,
        description="建角色",
    ),
    RouteRuleSpec(
        f"{_P}/roles*",
        "PATCH",
        codes=(ROLE_MANAGE,),
        priority=955,
        description="改角色",
    ),
    RouteRuleSpec(
        f"{_P}/roles*",
        "PUT",
        codes=(ROLE_MANAGE,),
        priority=955,
        description="覆盖式设置角色权限",
    ),
    RouteRuleSpec(
        f"{_P}/roles*",
        "DELETE",
        codes=(ROLE_MANAGE,),
        priority=955,
        description="删角色",
    ),
    RouteRuleSpec(
        f"{_P}/permissions*",
        "GET",
        codes=(USER_VIEW, ROLE_MANAGE),
        match_mode="any",
        priority=945,
        description="权限目录只读。配角色的人不一定有用户面的读码",
    ),
    RouteRuleSpec(
        f"{_P}/route-rules*",
        "GET",
        codes=(ROUTE_RULE_VIEW,),
        priority=925,
        description="规则列表与详情",
    ),
    RouteRuleSpec(
        f"{_P}/route-rules*",
        "POST",
        codes=(ROUTE_RULE_MANAGE,),
        priority=925,
        description="新增规则",
    ),
    RouteRuleSpec(
        f"{_P}/route-rules*",
        "PATCH",
        codes=(ROUTE_RULE_MANAGE,),
        priority=925,
        description="修改规则",
    ),
    RouteRuleSpec(
        f"{_P}/route-rules*",
        "DELETE",
        codes=(ROUTE_RULE_MANAGE,),
        priority=925,
        description="删除规则",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/health", "GET", priority=999, description="存活探针"
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/ready", "GET", priority=999, description="就绪探针"
    ),
    RouteRuleSpec(f"{_PLATFORM}/docs", "GET", priority=998, description="文档"),
    RouteRuleSpec(
        f"{_PLATFORM}/redoc", "GET", priority=998, description="文档"
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/openapi.json", "GET", priority=998, description="契约"
    ),
    # 试算与推荐是纯计算的读操作（POST 只因它带请求体）：viewer 也该能问
    # 「这样开多久达标」「今天开哪套最快」。窄规则压过下面按方法兜底的写权限
    RouteRuleSpec(
        f"{_PLATFORM}/ac-models/*:predict",
        "POST",
        codes=(AC_VIEW,),
        priority=905,
        description="达标时长试算，读档权限即可",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/ac-models/*:recommend",
        "POST",
        codes=(AC_VIEW,),
        priority=906,
        description="开机策略推荐，读档权限即可",
    ),
    # ⚠ `fnmatch` 的 `*` 跨斜杠，故这四条按方法兜住 platform 的整个对外面。
    # 将来某个资源要单独的码，加一条更高 priority 的窄规则压过它，别改这四条。
    RouteRuleSpec(
        f"{_PLATFORM}/*",
        "GET",
        codes=(AC_VIEW,),
        priority=900,
        description="空调、车间、房间的全部读面",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/*",
        "POST",
        codes=(AC_MANAGE,),
        priority=900,
        description="新建与批量改派",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/*",
        "PUT",
        codes=(AC_MANAGE,),
        priority=900,
        description="覆盖式写：数据源绑定与达标范围",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/*",
        "PATCH",
        codes=(AC_MANAGE,),
        priority=900,
        description="更新空调、车间、房间",
    ),
    RouteRuleSpec(
        f"{_PLATFORM}/*",
        "DELETE",
        codes=(AC_MANAGE,),
        priority=900,
        description="删除空调、车间、房间",
    ),
    # —— OPC UA 服务端（`/api/v1/opcua`）——
    # ⚠ 顺序即语义：首条命中即终局，且 `*` 跨斜杠。动作端点必须排在
    # 前缀兜底之前，否则 `:start` 会先命中 `instances*` 的读规则而被拒。
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
    # —— 实时通道（`/api/v1/realtime`）——
    # ⚠ 这一段一个权限码都不新增，这是 ADR-0007 第 3 条的直接后果：hub 的订阅
    # 授权**只比一次**——用户持有的码是否包含主题声明的码，没有第二处判断。
    # 给连接本身另设一道码就是那个被否掉的第二处判断，而且它挡不住任何东西：
    # 连上来却订不到任何主题的连接，一个字节也拿不到。主题声明的码由推送方在
    # 登记时给出（opcua 的主题声明 `opcua:view`），hub 登记时校验它在本目录里。
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
            "WebSocket 端点。任意已登录用户可连，能收到什么由每个主题声明的码"
            "另判。⚠ token 走子协议而不是 Authorization 头，闸 1 认不出它——"
            "匿名可达性必须由边缘免认证 location 保证，认证在 hub 内部完成"
        ),
    ),
)
