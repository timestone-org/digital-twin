"""锁住权限码目录本身的不变式。

权限码是**对外契约**：改一个字面量就是改了已落库的角色绑定与所有前端判定，
且不会有任何编译期报错。这个文件是它唯一的守卫。
"""

from auth_server.apps.auth import catalog
from auth_server.apps.auth.models import PERMISSION_KINDS
from auth_server.apps.auth.services.matching import is_redundant
from contract.rule_views import catalog_rule_views

# 已发布的权限码字面量。**只许新增，不许改名或删除。**
PUBLISHED_CODES = frozenset(
    {
        "user:view",
        "user:manage",
        "user:delete",
        "user:grant",
        "role:manage",
        "route_rule:view",
        "route_rule:manage",
        "ac:view",
        "ac:manage",
        "opcua:view",
        "opcua:operate",
        "opcua:manage",
        "dashboard:view",
        "dashboard:edit",
        "dashboard:manage",
        "collect:view",
        "collect:operate",
        "collect:manage",
        "assistant:use",
        "asset:view",
        "asset:manage",
        "dataset:view",
        "dataset:manage",
        "dataset:record:write",
        "dataset:override",
        "dataset:backfill",
        "formula:view",
        "formula:manage",
    }
)


def test_published_permission_codes_never_change() -> None:
    assert catalog.ALL_CODES == PUBLISHED_CODES


def test_permission_codes_are_unique() -> None:
    codes = [item.code for item in catalog.PERMISSIONS]
    assert len(codes) == len(set(codes))


def test_every_permission_kind_is_one_of_the_four_tiers() -> None:
    assert all(item.kind in PERMISSION_KINDS for item in catalog.PERMISSIONS)


def test_every_permission_carries_a_group_and_a_description() -> None:
    # 缺任何一项，角色配置界面上就是一个没有归属、没有解释的裸开关
    blank = [
        item.code
        for item in catalog.PERMISSIONS
        if not (item.name and item.description)
        or not (item.group_code and item.group_label)
    ]
    assert blank == []


def test_each_group_code_carries_a_single_label() -> None:
    # 同一个 group_code 配两个标签时，界面显示哪个取决于目录里的先后顺序
    labels: dict[str, set[str]] = {}
    for item in catalog.PERMISSIONS:
        labels.setdefault(item.group_code, set()).add(item.group_label)
    assert {code for code, seen in labels.items() if len(seen) > 1} == set()


def test_sort_order_is_unique_within_each_group() -> None:
    # 同组内并列的 sort_order 让组内次序退化成目录顺序，加一个码就会重排
    seen: dict[str, list[int]] = {}
    for item in catalog.PERMISSIONS:
        seen.setdefault(item.group_code, []).append(item.sort_order)
    collisions = {
        code for code, orders in seen.items() if len(orders) != len(set(orders))
    }
    assert collisions == set()


def test_admin_role_is_derived_from_the_whole_catalog() -> None:
    admin = next(
        role for role in catalog.ROLES if role.name == catalog.ROLE_ADMIN
    )
    assert frozenset(admin.codes) == catalog.ALL_CODES


def test_viewer_role_is_derived_from_the_view_tier() -> None:
    viewer = next(
        role for role in catalog.ROLES if role.name == catalog.ROLE_VIEWER
    )
    assert frozenset(viewer.codes) == frozenset(catalog.VIEW_CODES)


def test_role_manage_is_grouped_under_user_not_its_code_prefix() -> None:
    # 目录里唯一一处「码前缀 ≠ 分组」，前端按 group_code 归组而非按前缀切
    spec = next(
        item for item in catalog.PERMISSIONS if item.code == catalog.ROLE_MANAGE
    )
    assert spec.group_code == "user"


def test_every_route_rule_references_a_registered_code() -> None:
    unknown = {
        code
        for rule in catalog.ROUTE_RULES
        for code in rule.codes
        if code not in catalog.ALL_CODES
    }
    assert unknown == set()


def test_every_permission_code_is_consumed_by_a_route_rule() -> None:
    # 没有任何规则要的码，在角色配置界面上就是一个点了没有效果的开关
    consumed = {code for rule in catalog.ROUTE_RULES for code in rule.codes}
    assert catalog.ALL_CODES - consumed == set()


def test_route_rule_keys_are_unique() -> None:
    keys = [
        (rule.path_pattern, rule.http_method) for rule in catalog.ROUTE_RULES
    ]
    assert len(keys) == len(set(keys))


def test_no_route_rule_is_redundant() -> None:
    views = catalog_rule_views()
    noise = [
        f"{view.http_method} {view.path_pattern}"
        for view in views
        if is_redundant(view, views)
    ]
    assert noise == []


def test_permission_groups_keep_catalog_order_and_sorting() -> None:
    groups = catalog.grouped_permissions()
    assert [group.code for group in groups] == [
        "user",
        "system",
        "hvac",
        "opcua",
        "dashboard",
        "collect",
        "assistant",
        "asset",
        "dataset",
        "formula",
    ]
    for group in groups:
        orders = [item.sort_order for item in group.items]
        assert orders == sorted(orders)
