"""闸 1 对组态大屏那 42 条 `/api/v1/platform` 路由的判定钉死。

⚠ 这一层守的是**顺序**。闸 1 首条命中即终局，而 `fnmatch` 的 `*` 跨斜杠，
所以「动作端点」与「前缀兜底」的相对次序一旦写反，表现不是报错而是：
大屏自检被当成一次编辑而对只读用户 403，或者建删大屏落进编辑者的码里。

platform-server 的端点定义在另一个代码单元里，auth-server 看不见它的路由表，
因此这里按**文档化的端点清单**逐条断言（同 `test_opcua_route_matrix.py`）。
跨服务的一致性靠这份清单与那边 `tests/contract/test_route_matrix.py` 两头对齐。
"""

import pytest

from auth_server.apps.auth import catalog
from auth_server.apps.auth.services.matching import find_rule
from contract.rule_views import catalog_rule_views

PLATFORM_PREFIX = "/api/v1/platform"
SAMPLE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
PROJECT = f"{PLATFORM_PREFIX}/dashboard-projects/{SAMPLE_ID}"
DASHBOARD = f"{PLATFORM_PREFIX}/dashboards/{SAMPLE_ID}"
NODE = f"{PLATFORM_PREFIX}/dashboard-nodes/{SAMPLE_ID}"
BINDING = f"{PLATFORM_PREFIX}/dashboard-bindings/{SAMPLE_ID}"
TEMPLATE = f"{PLATFORM_PREFIX}/dashboard-templates/{SAMPLE_ID}"

VIEW = frozenset({catalog.DASHBOARD_VIEW})
EDIT = frozenset({catalog.DASHBOARD_EDIT})
MANAGE = frozenset({catalog.DASHBOARD_MANAGE})
DASHBOARD_CODES = VIEW | EDIT | MANAGE

# 端点 → 期望的权限码。逐条复述 platform-server 的真实路由表。
EXPECTED: tuple[tuple[str, str, frozenset[str]], ...] = (
    (f"{PLATFORM_PREFIX}/dashboard-projects", "GET", VIEW),
    (f"{PLATFORM_PREFIX}/dashboard-projects", "POST", MANAGE),
    (PROJECT, "GET", VIEW),
    (PROJECT, "PATCH", MANAGE),
    (PROJECT, "DELETE", MANAGE),
    (f"{PLATFORM_PREFIX}/dashboards", "GET", VIEW),
    (f"{PLATFORM_PREFIX}/dashboards", "POST", MANAGE),
    (DASHBOARD, "GET", VIEW),
    (DASHBOARD, "PATCH", EDIT),
    (DASHBOARD, "DELETE", MANAGE),
    (f"{DASHBOARD}:replace-layout", "POST", EDIT),
    (f"{DASHBOARD}:validate", "POST", VIEW),
    (f"{DASHBOARD}:publish", "POST", MANAGE),
    (f"{DASHBOARD}:unpublish", "POST", MANAGE),
    (f"{DASHBOARD}/nodes", "POST", EDIT),
    (f"{PLATFORM_PREFIX}/dashboard-nodes", "GET", VIEW),
    (NODE, "GET", VIEW),
    (NODE, "PATCH", EDIT),
    (NODE, "DELETE", EDIT),
    (f"{NODE}/bindings", "POST", EDIT),
    (f"{PLATFORM_PREFIX}/dashboard-bindings", "GET", VIEW),
    (BINDING, "PATCH", EDIT),
    (BINDING, "DELETE", EDIT),
    (f"{PLATFORM_PREFIX}/module-types", "GET", VIEW),
    (f"{PLATFORM_PREFIX}/module-types/twin-view", "GET", VIEW),
    # 复制与导入都建出一张新屏，与建屏同档；导出什么都不改，走读面
    (f"{DASHBOARD}:duplicate", "POST", MANAGE),
    (f"{DASHBOARD}:export", "POST", VIEW),
    (f"{PLATFORM_PREFIX}/dashboards:import", "POST", MANAGE),
    # 缩略图：读随大屏读面，写随大屏编辑面
    (f"{DASHBOARD}/thumbnail", "GET", VIEW),
    (f"{DASHBOARD}/thumbnail", "PUT", EDIT),
    # 项目自定义主题，整组读写都落在项目下
    (f"{PROJECT}/themes", "GET", VIEW),
    (f"{PROJECT}/themes", "POST", EDIT),
    (f"{PROJECT}/themes/{SAMPLE_ID}", "PATCH", EDIT),
    (f"{PROJECT}/themes/{SAMPLE_ID}", "DELETE", EDIT),
    # 模板全局可见：建删归 manage，读与实例化各自一档
    (f"{PLATFORM_PREFIX}/dashboard-templates", "GET", VIEW),
    (f"{PLATFORM_PREFIX}/dashboard-templates", "POST", MANAGE),
    (TEMPLATE, "GET", VIEW),
    (TEMPLATE, "DELETE", MANAGE),
    (f"{TEMPLATE}:instantiate", "POST", MANAGE),
    # 运行参数：看得见节拍不等于能改
    (f"{PLATFORM_PREFIX}/runtime-params", "GET", VIEW),
    (f"{PLATFORM_PREFIX}/runtime-params/dashboard", "PUT", EDIT),
    (f"{PLATFORM_PREFIX}/runtime-params/dashboard:reset", "POST", EDIT),
)

# 大屏面对外端点的条数。写死是为了让「加了端点没加规则」在这里红
DASHBOARD_ROUTE_COUNT = 42
# 公开只读面。它不在 EXPECTED 里：那批断言的前提是「每条恰好要一个大屏码」，
# 而这条要的是零个码
PUBLIC_DASHBOARD = (
    f"{PLATFORM_PREFIX}/public-dashboards/dGVzdC1wdWJsaWMtdG9rZW4"
)


def test_the_documented_face_covers_every_dashboard_route() -> None:
    """⚠ 漏一条 platform 的端点，下面逐条那批就静默少测一条。"""
    assert len(EXPECTED) == DASHBOARD_ROUTE_COUNT


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


def test_no_dashboard_route_falls_through_to_the_hvac_catch_all() -> None:
    """大屏的路径不许落到按方法兜住整个 platform 的那五条上。

    ⚠ 落下去不会报错，只会变成「持 `ac:manage` 的账号能改大屏、
    只有 `dashboard:*` 的账号一条都进不去」。
    """
    for path, method, _ in EXPECTED:
        rule = find_rule(catalog_rule_views(), path=path, method=method)
        assert rule is not None
        assert rule.permission_codes <= DASHBOARD_CODES


def test_every_dashboard_route_requires_exactly_one_code() -> None:
    """三个码互斥：同时要两个等于把「能看」与「能改」搅在一起。"""
    spread = [
        f"{method} {path}"
        for path, method, expected in EXPECTED
        if len(expected) != 1
    ]
    assert spread == []


def test_no_read_endpoint_demands_a_write_code() -> None:
    """GET 一律只要读码——读面要写码等于把看板做成登录即改。"""
    wrong = [
        f"GET {path}"
        for path, method, expected in EXPECTED
        if method == "GET" and expected != VIEW
    ]
    assert wrong == []


def test_no_mutating_endpoint_is_satisfied_by_the_read_code() -> None:
    """改数据的端点不许只要 view。

    `:validate` 与 `:export` 除外——两者都什么都不改，是 POST 只因为动作端点
    一律 POST。⚠ 往这张豁免名单里加东西前先确认它真的是只读：加错一条，
    就是让写操作只凭读码通过。
    """
    read_only_actions = (":validate", ":export")
    leaky = [
        f"{method} {path}"
        for path, method, expected in EXPECTED
        if method != "GET"
        and expected == VIEW
        and not path.endswith(read_only_actions)
    ]
    assert leaky == []


def test_the_self_check_action_beats_the_prefix_fallback() -> None:
    """`:validate` 必须命中动作规则，而不是 `dashboard*` 的写兜底。

    ⚠ 这条单列是因为它最容易错：`{prefix}/dashboard*` 的 priority 更低，
    但 `*` 跨斜杠使它同样匹配 `:validate` 的完整路径。
    """
    rule = find_rule(
        catalog_rule_views(), path=f"{DASHBOARD}:validate", method="POST"
    )
    assert rule is not None
    assert rule.path_pattern.endswith(":validate")
    assert rule.permission_codes == VIEW


def test_replace_layout_rides_the_edit_fallback_on_purpose() -> None:
    """整树替换也是 `:verb`，但它要的正是兜底那个码，故不另立规则。

    ⚠ 再写一条一模一样的窄规则会被冗余自检打回（那是噪音），
    这条用例负责证明「没写」不等于「漏了」。
    """
    rule = find_rule(
        catalog_rule_views(), path=f"{DASHBOARD}:replace-layout", method="POST"
    )
    assert rule is not None
    assert rule.path_pattern == f"{PLATFORM_PREFIX}/dashboard*"
    assert rule.permission_codes == EDIT


def test_creating_a_dashboard_is_not_swallowed_by_the_edit_fallback() -> None:
    """建大屏归 manage，而同前缀下的 `/nodes` 与 `:replace-layout` 归 edit。

    ⚠ 建大屏那条规则的模式**不带 `*`**，带上就会把这两条 POST 一起收进
    manage，编辑者于是改不动自己的大屏。
    """
    create = find_rule(
        catalog_rule_views(),
        path=f"{PLATFORM_PREFIX}/dashboards",
        method="POST",
    )
    assert create is not None
    assert create.permission_codes == MANAGE
    nested = find_rule(
        catalog_rule_views(), path=f"{DASHBOARD}/nodes", method="POST"
    )
    assert nested is not None
    assert nested.permission_codes == EDIT


def test_a_viewer_can_read_every_dashboard_but_change_nothing() -> None:
    """只读角色拿得到 view、拿不到 edit 与 manage。"""
    viewer = frozenset(
        next(
            role for role in catalog.ROLES if role.name == catalog.ROLE_VIEWER
        ).codes
    )
    assert viewer >= VIEW
    assert not viewer >= EDIT
    assert not viewer >= MANAGE


def test_an_editor_cannot_delete_a_dashboard() -> None:
    """编辑者改得动内容，删不掉大屏——删会连节点与绑定一起消失。"""
    editor = VIEW | EDIT
    rule = find_rule(catalog_rule_views(), path=DASHBOARD, method="DELETE")
    assert rule is not None
    assert not rule.permission_codes <= editor


def test_an_editor_cannot_publish_a_dashboard() -> None:
    """发布是把一张屏交给全互联网，编辑权限不够。

    ⚠ 少了 920 那两条窄规则，`:publish` 会落回 `dashboard*` 的写兜底，
    于是任何编辑者都能悄悄把内网大屏挂上公网，而这件事没有任何提示。
    """
    editor = VIEW | EDIT
    for path in (f"{DASHBOARD}:publish", f"{DASHBOARD}:unpublish"):
        rule = find_rule(catalog_rule_views(), path=path, method="POST")
        assert rule is not None
        assert rule.permission_codes == MANAGE
        assert not rule.permission_codes <= editor


def test_the_public_face_is_not_swallowed_by_the_hvac_catch_all() -> None:
    """公开只读面命中它自己那条空码规则，而不是按方法兜底的 `ac:view`。

    ⚠ 落到兜底上的表现是：登录用户里只有持 `ac:view` 的人打得开公开链接，
    而这条链接本该是给未登录访客的。
    """
    rule = find_rule(catalog_rule_views(), path=PUBLIC_DASHBOARD, method="GET")
    assert rule is not None
    assert rule.path_pattern == f"{PLATFORM_PREFIX}/public-dashboards/*"
    assert rule.permission_codes == frozenset()


def test_the_public_prefix_holds_for_every_method() -> None:
    """公开前缀下的写方法也留在那条空码规则上，不落进大屏的写码。

    ⚠ 这里断的是「不会有人以为公开前缀下的 POST 被 `dashboard:edit` 挡着」：
    它根本没被任何权限码挡，挡它的是那里压根没有写端点。
    """
    rule = find_rule(catalog_rule_views(), path=PUBLIC_DASHBOARD, method="POST")
    assert rule is not None
    assert rule.permission_codes == frozenset()
