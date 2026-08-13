"""权限码目录与内置角色，全系统权限口径的唯一真源；规则见 `route_catalog.py`。

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
OPCUA_VIEW = "opcua:view"
OPCUA_OPERATE = "opcua:operate"
OPCUA_MANAGE = "opcua:manage"

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
    PermissionSpec(
        code=OPCUA_VIEW,
        name="查看 OPC UA 服务端",
        kind="view",
        group_code="opcua",
        group_label="OPC UA 服务端",
        sort_order=10,
        description="实例、地址空间节点、在线会话与端口池的全部读面",
    ),
    PermissionSpec(
        code=OPCUA_OPERATE,
        name="起停实例与写节点值",
        kind="operate",
        group_code="opcua",
        group_label="OPC UA 服务端",
        sort_order=20,
        description=(
            "起停/重启实例、向节点写值。⚠ 停实例会断开全部上位机会话；"
            "写值等于改变上位系统读到的现场数据"
        ),
    ),
    PermissionSpec(
        code=OPCUA_MANAGE,
        name="管理实例、节点与接入凭据",
        kind="admin",
        group_code="opcua",
        group_label="OPC UA 服务端",
        sort_order=30,
        description=(
            "增删实例与节点、改安全策略、管理上位机凭据与信任证书。"
            "⚠ 归高危档是因为后半段决定「哪台上位机连得进来」"
        ),
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
