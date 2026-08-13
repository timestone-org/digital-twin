"""闸 1 对 `/api/v1/opcua` 的判定钉死。

⚠ 这一层守的是**顺序**。闸 1 首条命中即终局，而 `fnmatch` 的 `*` 跨斜杠，
所以「动作端点」与「前缀兜底」的相对次序一旦写反，表现不是报错而是：
起停实例被当成读操作放行给只读用户，或者写值被读规则拦下报 403。
两种都不会有人在代码评审里一眼看出来。

opcua-server 的端点定义在另一个代码单元里，auth-server 看不见它的路由表，
因此这里按**文档化的端点清单**逐条断言，而不是遍历真实路由。跨服务的
一致性只能靠这份清单与那边的契约测试两头对齐——它不是机器闭环，见 §评审。
"""

import pytest

from auth_server.apps.auth import catalog, route_catalog
from auth_server.apps.auth.services.matching import RuleView, find_rule

OPCUA_PREFIX = "/api/v1/opcua"
INSTANCE = f"{OPCUA_PREFIX}/instances/3fa85f64-5717-4562-b3fc-2c963f66afa6"
NODE = f"{INSTANCE}/nodes/7c9e6679-7425-40de-944b-e07fc1f90ae7"

# 端点 → 期望的权限码。空 frozenset = 任意已登录用户放行。
EXPECTED: tuple[tuple[str, str, frozenset[str]], ...] = (
    (f"{OPCUA_PREFIX}/health", "GET", frozenset()),
    (f"{OPCUA_PREFIX}/ready", "GET", frozenset()),
    (f"{OPCUA_PREFIX}/openapi.json", "GET", frozenset()),
    (f"{OPCUA_PREFIX}/instances", "GET", frozenset({catalog.OPCUA_VIEW})),
    (
        f"{OPCUA_PREFIX}/instances/port-pool",
        "GET",
        frozenset({catalog.OPCUA_VIEW}),
    ),
    (INSTANCE, "GET", frozenset({catalog.OPCUA_VIEW})),
    (f"{INSTANCE}/nodes", "GET", frozenset({catalog.OPCUA_VIEW})),
    (f"{NODE}/value", "GET", frozenset({catalog.OPCUA_VIEW})),
    (f"{INSTANCE}/sessions", "GET", frozenset({catalog.OPCUA_VIEW})),
    (
        f"{OPCUA_PREFIX}/instances",
        "POST",
        frozenset({catalog.OPCUA_MANAGE}),
    ),
    (f"{INSTANCE}/nodes", "POST", frozenset({catalog.OPCUA_MANAGE})),
    (INSTANCE, "PUT", frozenset({catalog.OPCUA_MANAGE})),
    (NODE, "PUT", frozenset({catalog.OPCUA_MANAGE})),
    (INSTANCE, "DELETE", frozenset({catalog.OPCUA_MANAGE})),
    (NODE, "DELETE", frozenset({catalog.OPCUA_MANAGE})),
    (f"{INSTANCE}:start", "POST", frozenset({catalog.OPCUA_OPERATE})),
    (f"{INSTANCE}:stop", "POST", frozenset({catalog.OPCUA_OPERATE})),
    (f"{INSTANCE}:restart", "POST", frozenset({catalog.OPCUA_OPERATE})),
    (f"{NODE}:write", "POST", frozenset({catalog.OPCUA_OPERATE})),
    (f"{INSTANCE}/credentials", "GET", frozenset({catalog.OPCUA_MANAGE})),
    (f"{INSTANCE}/credentials", "POST", frozenset({catalog.OPCUA_MANAGE})),
    (
        f"{INSTANCE}/trusted-certificates",
        "GET",
        frozenset({catalog.OPCUA_MANAGE}),
    ),
    (
        f"{INSTANCE}/trusted-certificates",
        "DELETE",
        frozenset({catalog.OPCUA_MANAGE}),
    ),
)


def _rules() -> list[RuleView]:
    return [
        RuleView(
            path_pattern=spec.path_pattern,
            http_method=spec.http_method,
            permission_codes=frozenset(spec.codes),
            match_mode=spec.match_mode,
            priority=spec.priority,
        )
        for spec in route_catalog.ROUTE_RULES
    ]


@pytest.mark.parametrize(("path", "method", "expected"), EXPECTED)
def test_each_endpoint_resolves_to_the_intended_codes(
    path: str, method: str, expected: frozenset[str]
) -> None:
    """逐条断言首条命中的规则要的正是那组码。

    Args: path, method, expected。
    """
    rule = find_rule(_rules(), path=path, method=method)
    assert rule is not None, f"{method} {path} 没有任何规则命中——闸 1 会拒绝"
    assert rule.permission_codes == expected


def test_no_opcua_endpoint_falls_through_to_another_service() -> None:
    """opcua 的路径不许命中 auth 的规则，反之亦然。

    ⚠ `*` 跨斜杠，`/api/v1/auth/users*` 这类模式一旦写成更宽的形状，
    会把别的服务的路径一起吃掉，而现象是「莫名其妙要 user:view」。
    """
    for path, method, _ in EXPECTED:
        rule = find_rule(_rules(), path=path, method=method)
        assert rule is not None
        assert rule.path_pattern.startswith(OPCUA_PREFIX)


def test_a_viewer_cannot_start_or_stop_an_instance() -> None:
    """只读角色拿不到 operate——起停会断开全部上位机会话。"""
    viewer = frozenset(catalog.ROLES[1].codes)
    for verb in (":start", ":stop", ":restart"):
        rule = find_rule(_rules(), path=f"{INSTANCE}{verb}", method="POST")
        assert rule is not None
        assert not rule.permission_codes <= viewer


def test_a_viewer_cannot_read_credentials() -> None:
    """⚠ 凭据的**读面**也要 manage：列表即暴露上位机账号名。"""
    viewer = frozenset(catalog.ROLES[1].codes)
    rule = find_rule(_rules(), path=f"{INSTANCE}/credentials", method="GET")
    assert rule is not None
    assert not rule.permission_codes <= viewer


def test_write_value_is_not_swallowed_by_the_read_rule() -> None:
    """写值必须命中动作规则，而不是 `instances*` 的 GET 兜底。

    ⚠ 这条单列是因为它最容易错：`{prefix}/instances*` 的模式长度短、
    优先级低，但 `*` 跨斜杠使它同样匹配 `:write` 的完整路径。
    """
    rule = find_rule(_rules(), path=f"{NODE}:write", method="POST")
    assert rule is not None
    assert rule.path_pattern.endswith(":write")
    assert rule.permission_codes == frozenset({catalog.OPCUA_OPERATE})
