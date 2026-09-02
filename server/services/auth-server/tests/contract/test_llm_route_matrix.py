"""闸 1 对模型供应商面那几条 `/api/v1/platform/llm-*` 路由的判定钉死。

⚠ 这一层守的是**顺序**。闸 1 首条命中即终局，而 `fnmatch` 的 `*` 跨斜杠：
`{platform}/*` 那五条按方法兜底的规则同样匹配 `/llm-providers/…`，供应商规则
压不过它们就成了「拿 `ac:manage` 能改整套部署的模型密钥」。

platform-server 的端点定义在另一个代码单元里，auth-server 看不见它的路由表，
因此这里按**文档化的端点清单**逐条断言（同 `test_asset_route_matrix.py`）。
"""

import pytest

from auth_server.apps.auth import catalog
from auth_server.apps.auth.services.matching import find_rule
from contract.rule_views import catalog_rule_views

PLATFORM_PREFIX = "/api/v1/platform"
SAMPLE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
PROVIDERS = f"{PLATFORM_PREFIX}/llm-providers"
PROVIDER = f"{PROVIDERS}/{SAMPLE_ID}"
PURPOSES = f"{PLATFORM_PREFIX}/llm-purposes"
PURPOSE = f"{PURPOSES}/assistant.chat"

VIEW = frozenset({catalog.LLM_VIEW})
MANAGE = frozenset({catalog.LLM_MANAGE})
LLM_CODES = VIEW | MANAGE

# 端点 → 期望的权限码。逐条复述 platform-server 的真实路由表。
EXPECTED: tuple[tuple[str, str, frozenset[str]], ...] = (
    (PROVIDERS, "GET", VIEW),
    (PROVIDER, "GET", VIEW),
    (PROVIDERS, "POST", MANAGE),
    (PROVIDER, "PATCH", MANAGE),
    (PROVIDER, "DELETE", MANAGE),
    # 探测拿着密钥去打外部端点，看得见目录的人不该能拿密钥去试别的地址
    (f"{PROVIDERS}:probe", "POST", MANAGE),
    (f"{PROVIDER}:probe", "POST", MANAGE),
    (PURPOSES, "GET", VIEW),
    (PURPOSE, "PUT", MANAGE),
    (PURPOSE, "DELETE", MANAGE),
)

# 对外端点的条数。写死是为了让「加了端点没加规则」在这里红
LLM_ROUTE_COUNT = 10


def test_the_documented_face_covers_every_llm_route() -> None:
    """⚠ 漏一条端点，下面逐条那批就静默少测一条。"""
    assert len(EXPECTED) == LLM_ROUTE_COUNT


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


def test_no_llm_route_falls_through_to_the_platform_catch_all() -> None:
    """供应商的路径不许落到按方法兜住整个 platform 的那五条上。"""
    for path, method, _ in EXPECTED:
        rule = find_rule(catalog_rule_views(), path=path, method=method)
        assert rule is not None
        assert rule.permission_codes <= LLM_CODES


def test_reading_never_needs_the_manage_code() -> None:
    """只读用户要看得到接了哪几路。

    ⚠ 写兜底那条用的是 `*` 方法，它同样匹配 GET；读规则压不过去时，
    只读用户连模型管理页都打不开，而现象是一个空列表加一句 403。
    """
    for path in (PROVIDERS, PROVIDER, PURPOSES):
        rule = find_rule(catalog_rule_views(), path=path, method="GET")
        assert rule is not None
        assert rule.permission_codes == VIEW


def test_the_internal_catalog_is_not_a_public_route() -> None:
    """内部目录带明文密钥，只走服务级密钥，边缘对 `/internal/` 一律 deny——
    目录里不该有任何一条规则给它开对外的门。"""
    rule = find_rule(
        catalog_rule_views(),
        path="/internal/v1/platform/llm-catalog",
        method="GET",
    )
    assert rule is None
