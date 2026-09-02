"""闸 1 对 `/api/v1/knowledge` 的判定钉死。

knowledge-server 的端点定义在另一个代码单元里，auth-server 看不见它的路由表，
因此这里按**文档化的端点清单**逐条断言（同 `test_realtime_route_matrix.py`）。

⚠ 这一段守的核心是语音输入那条 WS **带** `knowledge:use`——与 realtime 的 WS
相反。realtime 的 token 在子协议里、边缘免认证、hub 自己验；这里边缘用
`/_auth_ws` 把子协议里的 token 映射成 Authorization 再来问规则表，所以规则表
必须有这一条且要码。漏了它的表现是「能力面说接了语音、一开麦就 403」。
"""

import pytest

from auth_server.apps.auth.catalog import KNOWLEDGE_USE
from auth_server.apps.auth.services.matching import find_rule
from contract.rule_views import catalog_rule_views

KNOWLEDGE_PREFIX = "/api/v1/knowledge"

# 端点 → 期望的权限码。空 frozenset = 任意已登录用户放行。
EXPECTED: tuple[tuple[str, str, frozenset[str]], ...] = (
    (f"{KNOWLEDGE_PREFIX}/health", "GET", frozenset()),
    (f"{KNOWLEDGE_PREFIX}/ready", "GET", frozenset()),
    (f"{KNOWLEDGE_PREFIX}/openapi.json", "GET", frozenset()),
    (f"{KNOWLEDGE_PREFIX}/capabilities", "GET", frozenset({KNOWLEDGE_USE})),
    (f"{KNOWLEDGE_PREFIX}/speech/ws", "GET", frozenset({KNOWLEDGE_USE})),
    (
        f"{KNOWLEDGE_PREFIX}/chat-sessions",
        "POST",
        frozenset({KNOWLEDGE_USE}),
    ),
)


@pytest.mark.parametrize(("path", "method", "expected"), EXPECTED)
def test_each_endpoint_resolves_to_the_intended_codes(
    path: str, method: str, expected: frozenset[str]
) -> None:
    rule = find_rule(catalog_rule_views(), path=path, method=method)
    assert rule is not None, f"{method} {path} 没有任何规则命中，闸 1 会直接拒"
    assert rule.permission_codes == expected


def test_speech_websocket_needs_the_same_code_as_search() -> None:
    """⚠ 不新造 `knowledge:speech`：它与 `knowledge:use` 之间没有任何一种
    「能 A 不能 B」的真实诉求，造出来只是角色配置界面上多一个没人分得清的勾。"""
    rule = find_rule(
        catalog_rule_views(), path=f"{KNOWLEDGE_PREFIX}/speech/ws", method="GET"
    )
    assert rule is not None
    assert rule.permission_codes == frozenset({KNOWLEDGE_USE})


def test_speech_websocket_is_not_swallowed_by_a_broader_rule() -> None:
    """⚠ 规则按优先级排：语音那条若排在 `knowledge-bases*` 这类通配之后，
    命中的就是别的码，而表现是「某些角色开麦 403、检索却好好的」。"""
    rule = find_rule(
        catalog_rule_views(), path=f"{KNOWLEDGE_PREFIX}/speech/ws", method="GET"
    )
    assert rule is not None
    assert rule.path_pattern == f"{KNOWLEDGE_PREFIX}/speech/ws"
