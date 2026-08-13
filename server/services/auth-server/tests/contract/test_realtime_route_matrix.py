"""闸 1 对 `/api/v1/realtime` 的判定钉死。

realtime-hub 的端点定义在另一个代码单元里，auth-server 看不见它的路由表，
因此这里按**文档化的端点清单**逐条断言（同 `test_opcua_route_matrix.py`）。

⚠ 这一段守的核心是「WS 端点不带权限码」这条**反向**不变式。它看着像漏写，
其实是 ADR-0007 第 3 条：hub 的订阅授权只比一次——用户持有的码是否包含
主题声明的码。
哪天有人顺手给这条规则补上一个码，订阅链路上就出现了第二处判断，而表现是
「某些用户连都连不上，日志里只有一条 403」——查起来要跨两个服务。
"""

import pytest

from auth_server.apps.auth import catalog
from auth_server.apps.auth.services.matching import RuleView, find_rule

REALTIME_PREFIX = "/api/v1/realtime"

# 端点 → 期望的权限码。空 frozenset = 任意已登录用户放行。
EXPECTED: tuple[tuple[str, str, frozenset[str]], ...] = (
    (f"{REALTIME_PREFIX}/health", "GET", frozenset()),
    (f"{REALTIME_PREFIX}/ready", "GET", frozenset()),
    (f"{REALTIME_PREFIX}/docs", "GET", frozenset()),
    (f"{REALTIME_PREFIX}/redoc", "GET", frozenset()),
    (f"{REALTIME_PREFIX}/openapi.json", "GET", frozenset()),
    (f"{REALTIME_PREFIX}/ws", "GET", frozenset()),
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
        for spec in catalog.ROUTE_RULES
    ]


@pytest.mark.parametrize(("path", "method", "expected"), EXPECTED)
def test_each_endpoint_resolves_to_the_intended_codes(
    path: str, method: str, expected: frozenset[str]
) -> None:
    rule = find_rule(_rules(), path=path, method=method)
    assert rule is not None, f"{method} {path} 没有任何规则命中，闸 1 会直接拒"
    assert rule.permission_codes == expected


def test_websocket_endpoint_carries_no_permission_code() -> None:
    """⚠ 反向不变式：给它补码就是 ADR-0007 否掉的第二处判断。"""
    rule = find_rule(_rules(), path=f"{REALTIME_PREFIX}/ws", method="GET")
    assert rule is not None
    assert rule.permission_codes == frozenset()


def test_realtime_section_adds_no_permission_code() -> None:
    """整个 realtime 段不许引入 `realtime:*` 码——没有消费方的码不进目录。"""
    assert not any(code.startswith("realtime:") for code in catalog.ALL_CODES)


def test_internal_push_endpoint_has_no_seeded_rule() -> None:
    """推送端点在 `/internal/` 下，走服务级密钥，不该出现在闸 1 的表里。"""
    assert (
        find_rule(_rules(), path="/internal/v1/realtime/publish", method="POST")
        is None
    )
