"""闸 1 对数据采集那 14 条 `/api/v1/platform` 路由的判定钉死。

⚠ 这一层守的是**顺序**。闸 1 首条命中即终局，而 `fnmatch` 的 `*` 跨斜杠，
所以 `:test` / `:browse` / `:write` 一旦排在前缀兜底之后，就会被当成一次
「改配置」——持 `collect:manage` 的账号因此能对现场设备下发写值。

platform-server 的端点定义在另一个代码单元里，auth-server 看不见它的路由表，
因此这里按**文档化的端点清单**逐条断言（同 `test_opcua_route_matrix.py`）。
"""

import pytest

from auth_server.apps.auth import catalog
from auth_server.apps.auth.services.matching import find_rule
from contract.rule_views import catalog_rule_views

PLATFORM_PREFIX = "/api/v1/platform"
INTERNAL_PLAN = "/internal/v1/platform/collect-plan"
SAMPLE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
SOURCE = f"{PLATFORM_PREFIX}/collect-sources/{SAMPLE_ID}"
POINT = f"{PLATFORM_PREFIX}/collect-points/{SAMPLE_ID}"
HISTORIES = f"{PLATFORM_PREFIX}/point-histories"

VIEW = frozenset({catalog.COLLECT_VIEW})
OPERATE = frozenset({catalog.COLLECT_OPERATE})
MANAGE = frozenset({catalog.COLLECT_MANAGE})
COLLECT_CODES = VIEW | OPERATE | MANAGE

# 端点 → 期望的权限码。逐条复述 platform-server 的真实路由表。
EXPECTED: tuple[tuple[str, str, frozenset[str]], ...] = (
    (f"{PLATFORM_PREFIX}/collect-sources", "GET", VIEW),
    (f"{PLATFORM_PREFIX}/collect-sources", "POST", MANAGE),
    (SOURCE, "GET", VIEW),
    (SOURCE, "PATCH", MANAGE),
    (SOURCE, "DELETE", MANAGE),
    (f"{SOURCE}:test", "POST", OPERATE),
    (f"{SOURCE}:browse", "POST", OPERATE),
    (f"{PLATFORM_PREFIX}/collect-points", "GET", VIEW),
    (f"{PLATFORM_PREFIX}/collect-points", "POST", MANAGE),
    (POINT, "PATCH", MANAGE),
    (POINT, "DELETE", MANAGE),
    (f"{POINT}:write", "POST", OPERATE),
    (HISTORIES, "GET", VIEW),
    (f"{HISTORIES}:aggregate", "POST", VIEW),
)

# 采集面对外端点的条数。写死是为了让「加了端点没加规则」在这里红
COLLECT_ROUTE_COUNT = 14
# 会在现场设备上产生一次真实往返的三条
FIELD_ACTIONS = (
    (f"{SOURCE}:test", "POST"),
    (f"{SOURCE}:browse", "POST"),
    (f"{POINT}:write", "POST"),
)


def test_the_documented_face_covers_every_collect_route() -> None:
    """⚠ 漏一条 platform 的端点，下面逐条那批就静默少测一条。"""
    assert len(EXPECTED) == COLLECT_ROUTE_COUNT


@pytest.mark.parametrize(("path", "method", "expected"), EXPECTED)
def test_each_endpoint_resolves_to_the_intended_codes(
    path: str, method: str, expected: frozenset[str]
) -> None:
    """逐条断言首条命中的规则要的正是那组码。

    Args: path, method, expected。
    """
    rule = find_rule(catalog_rule_views(), path=path, method=method)
    assert rule is not None, f"{method} {path} 没有任何规则命中——闸 1 会拒绝"
    assert rule.permission_codes == expected


def test_no_collect_route_falls_through_to_the_hvac_catch_all() -> None:
    """采集的路径不许落到按方法兜住整个 platform 的那五条上。

    ⚠ 落下去不会报错，只会变成「持 `ac:manage` 的账号能改采集配置、
    只有 `collect:*` 的账号一条都进不去」。
    """
    for path, method, _ in EXPECTED:
        rule = find_rule(catalog_rule_views(), path=path, method=method)
        assert rule is not None
        assert rule.permission_codes <= COLLECT_CODES


def test_every_collect_route_requires_exactly_one_code() -> None:
    """三个码互斥：它们分别是「能看」「能碰现场」「能改配置」。"""
    spread = [
        f"{method} {path}"
        for path, method, expected in EXPECTED
        if len(expected) != 1
    ]
    assert spread == []


def test_no_read_endpoint_demands_a_write_code() -> None:
    """GET 一律只要读码。"""
    wrong = [
        f"GET {path}"
        for path, method, expected in EXPECTED
        if method == "GET" and expected != VIEW
    ]
    assert wrong == []


def test_no_mutating_endpoint_is_satisfied_by_the_read_code() -> None:
    """改数据或碰现场的端点不许只要 view，`:aggregate` 除外。"""
    leaky = [
        f"{method} {path}"
        for path, method, expected in EXPECTED
        if method != "GET"
        and expected == VIEW
        and not path.endswith(":aggregate")
    ]
    assert leaky == []


@pytest.mark.parametrize(("path", "method"), FIELD_ACTIONS)
def test_a_field_action_beats_the_prefix_fallback(
    path: str, method: str
) -> None:
    """三条动作端点必须命中动作规则，而不是 `collect-*` 的写兜底。

    ⚠ 这三条单列是因为它们最容易错：`{prefix}/collect-*` 的 priority 更低，
    但 `*` 跨斜杠使它同样匹配 `:test` / `:browse` / `:write` 的完整路径。
    Args: path, method。
    """
    rule = find_rule(catalog_rule_views(), path=path, method=method)
    assert rule is not None
    assert ":" in rule.path_pattern.rsplit("/", maxsplit=1)[-1]
    assert rule.permission_codes == OPERATE


def test_aggregating_history_stays_on_the_read_code() -> None:
    """聚合是 POST 只因动作端点一律 POST，它不改任何东西。

    ⚠ 没有这条窄规则，它会落进 `point-histories*` 的写兜底，
    只读用户于是看不了任何一条历史曲线。
    """
    rule = find_rule(
        catalog_rule_views(), path=f"{HISTORIES}:aggregate", method="POST"
    )
    assert rule is not None
    assert rule.path_pattern.endswith(":aggregate")
    assert rule.permission_codes == VIEW


def test_a_viewer_can_read_but_neither_configure_nor_touch_the_field() -> None:
    """只读角色拿得到 view，拿不到 operate 与 manage。"""
    viewer = frozenset(
        next(
            role for role in catalog.ROLES if role.name == catalog.ROLE_VIEWER
        ).codes
    )
    assert viewer >= VIEW
    assert not viewer >= OPERATE
    assert not viewer >= MANAGE


def test_configuring_points_does_not_grant_writing_to_the_field() -> None:
    """改一行配置与在设备上下发写值不是同一类风险，故 operate 单列一档。"""
    configurer = VIEW | MANAGE
    rule = find_rule(catalog_rule_views(), path=f"{POINT}:write", method="POST")
    assert rule is not None
    assert not rule.permission_codes <= configurer


def test_the_internal_collect_plan_has_no_seeded_rule() -> None:
    """内部面走服务级密钥，边缘对 `/internal/` 一律 deny。

    ⚠ 给它配一条规则等于承认「带上某个人的身份也能拉走全量采集计划」。
    """
    assert (
        find_rule(catalog_rule_views(), path=INTERNAL_PLAN, method="GET")
        is None
    )
