"""权限码目录、内置角色与内置路由规则 —— 全系统权限口径的唯一真源。

只登记**已经有消费方**的码：无端点无页面的占位码不进目录，否则角色配置界面
会摆出一排点了没有任何效果的开关。新功能面上线时同批加码、加规则、加契约测试。
划分口径与三道闸见 ../../../CONTEXT.md。
"""

from dataclasses import dataclass, field

# ---- 权限码 ----

USER_VIEW = "user:view"
USER_MANAGE = "user:manage"
USER_DELETE = "user:delete"
USER_GRANT = "user:grant"
ROLE_MANAGE = "role:manage"
ROUTE_RULE_VIEW = "route_rule:view"
ROUTE_RULE_MANAGE = "route_rule:manage"
# platform-server 的 apps/hvac 消费这两个码。服务之间不许互相 import，
# 那边的 apps/hvac/catalog.py 只是复述，两边必须逐字一致
AC_VIEW = "ac:view"
AC_MANAGE = "ac:manage"

# ---- 内置角色 ----

ROLE_ADMIN = "admin"
ROLE_VIEWER = "viewer"


@dataclass(frozen=True)
class PermissionSpec:
    """目录里的一条权限码。`kind` 四档见 CONTEXT.md。"""

    code: str
    name: str
    kind: str
    group_code: str
    group_label: str
    sort_order: int
    description: str


@dataclass(frozen=True)
class RoleSpec:
    """一个内置角色。权限集从目录机械推导，不手抄清单。"""

    name: str
    description: str
    codes: tuple[str, ...]


@dataclass(frozen=True)
class RouteRuleSpec:
    """一条内置路由规则。空 `codes` = 任意已登录用户放行。"""

    path_pattern: str
    http_method: str
    codes: tuple[str, ...] = ()
    match_mode: str = "all"
    priority: int = 0
    description: str = ""


PERMISSIONS: tuple[PermissionSpec, ...] = (
    PermissionSpec(
        code=USER_VIEW,
        name="查看用户与角色",
        kind="view",
        group_code="user",
        group_label="用户与角色",
        sort_order=10,
        description="用户列表与详情、角色列表与详情、权限目录的全部读面",
    ),
    PermissionSpec(
        code=USER_MANAGE,
        name="管理用户",
        kind="manage",
        group_code="user",
        group_label="用户与角色",
        sort_order=20,
        description="新建用户、编辑资料、启停账号、重置他人密码",
    ),
    PermissionSpec(
        code=USER_DELETE,
        name="删除用户",
        kind="admin",
        group_code="user",
        group_label="用户与角色",
        sort_order=30,
        description="删除账号，不可恢复",
    ),
    PermissionSpec(
        code=USER_GRANT,
        name="授予用户角色与直权",
        kind="admin",
        group_code="user",
        group_label="用户与角色",
        sort_order=40,
        description="改派角色、覆盖式写用户直权。提权入口",
    ),
    PermissionSpec(
        code=ROLE_MANAGE,
        name="管理角色与角色权限",
        kind="admin",
        group_code="user",
        group_label="用户与角色",
        sort_order=50,
        description="建改删角色、覆盖式设置角色权限。整套 RBAC 的提权入口",
    ),
    PermissionSpec(
        code=ROUTE_RULE_VIEW,
        name="查看路由权限规则",
        kind="view",
        group_code="system",
        group_label="系统配置",
        sort_order=10,
        description="鉴权矩阵的列表与详情",
    ),
    PermissionSpec(
        code=ROUTE_RULE_MANAGE,
        name="管理路由权限规则",
        kind="admin",
        group_code="system",
        group_label="系统配置",
        sort_order=20,
        description="增删改路由规则，改动即改变全系统鉴权矩阵",
    ),
    PermissionSpec(
        code=AC_VIEW,
        name="查看空调与空间",
        kind="view",
        group_code="hvac",
        group_label="空调与空间",
        sort_order=10,
        description="空调台账、车间与房间的全部读面",
    ),
    PermissionSpec(
        code=AC_MANAGE,
        name="管理空调与空间",
        kind="manage",
        group_code="hvac",
        group_label="空调与空间",
        sort_order=20,
        description="增删改空调、车间、房间，以及批量改派空调所在房间",
    ),
)

ALL_CODES: frozenset[str] = frozenset(item.code for item in PERMISSIONS)
VIEW_CODES: tuple[str, ...] = tuple(
    item.code for item in PERMISSIONS if item.kind == "view"
)

ROLES: tuple[RoleSpec, ...] = (
    RoleSpec(
        name=ROLE_ADMIN,
        description="管理员：持有全部权限码",
        codes=tuple(sorted(ALL_CODES)),
    ),
    RoleSpec(
        name=ROLE_VIEWER,
        description="只读用户：持有全部查看档权限码",
        codes=VIEW_CODES,
    ),
)

_P = "/api/v1/auth"
_PLATFORM = "/api/v1/platform"

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
)


@dataclass(frozen=True)
class PermissionGroup:
    """界面上的一个权限分组。"""

    code: str
    label: str
    items: tuple[PermissionSpec, ...] = field(default_factory=tuple)


def grouped_permissions() -> tuple[PermissionGroup, ...]:
    """按 `group_code` 归组，组内按 `sort_order` 升序。"""
    order: list[str] = []
    buckets: dict[str, list[PermissionSpec]] = {}
    for item in PERMISSIONS:
        if item.group_code not in buckets:
            buckets[item.group_code] = []
            order.append(item.group_code)
        buckets[item.group_code].append(item)
    return tuple(
        PermissionGroup(
            code=code,
            label=buckets[code][0].group_label,
            items=tuple(
                sorted(buckets[code], key=lambda spec: spec.sort_order)
            ),
        )
        for code in order
    )
