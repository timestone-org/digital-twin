"""目录里三种记录的形状：权限码、角色、路由规则各一个冻结数据类。

形状集中在这里，`permissions` / `roles` / `rules_*` 各模块只装数据。
"""

from dataclasses import dataclass, field


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


@dataclass(frozen=True)
class PermissionGroup:
    """界面上的一个权限分组。"""

    code: str
    label: str
    items: tuple[PermissionSpec, ...] = field(default_factory=tuple)
