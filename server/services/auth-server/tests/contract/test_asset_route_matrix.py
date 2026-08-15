"""闸 1 对素材面那 6 条 `/api/v1/platform/assets` 路由的判定钉死。

⚠ 这一层守的是**顺序**。闸 1 首条命中即终局，而 `fnmatch` 的 `*` 跨斜杠：
`{platform}/*` 那五条按方法兜底的规则同样匹配 `/assets/…`，素材规则压不过
它们就成了「拿 `ac:manage` 能删素材，而只有 `asset:manage` 的一条都进不去」。

platform-server 的端点定义在另一个代码单元里，auth-server 看不见它的路由表，
因此这里按**文档化的端点清单**逐条断言（同 `test_dashboard_route_matrix.py`）。
"""

import pytest

from auth_server.apps.auth import catalog
from auth_server.apps.auth.services.matching import find_rule
from contract.rule_views import catalog_rule_views

PLATFORM_PREFIX = "/api/v1/platform"
SAMPLE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
ASSETS = f"{PLATFORM_PREFIX}/assets"
ASSET = f"{ASSETS}/{SAMPLE_ID}"

VIEW = frozenset({catalog.ASSET_VIEW})
MANAGE = frozenset({catalog.ASSET_MANAGE})
ASSET_CODES = VIEW | MANAGE

# 端点 → 期望的权限码。逐条复述 platform-server 的真实路由表。
EXPECTED: tuple[tuple[str, str, frozenset[str]], ...] = (
    (ASSETS, "GET", VIEW),
    (f"{ASSETS}/kinds", "GET", VIEW),
    (ASSET, "GET", VIEW),
    # 直传三步里只有这两步经过本服务，第二步是浏览器直连对象存储
    (f"{ASSETS}:presign-upload", "POST", MANAGE),
    (f"{ASSET}:finalize", "POST", MANAGE),
    (ASSET, "DELETE", MANAGE),
)

# 素材面对外端点的条数。写死是为了让「加了端点没加规则」在这里红
ASSET_ROUTE_COUNT = 6


def test_the_documented_face_covers_every_asset_route() -> None:
    """⚠ 漏一条端点，下面逐条那批就静默少测一条。"""
    assert len(EXPECTED) == ASSET_ROUTE_COUNT


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


def test_no_asset_route_falls_through_to_the_platform_catch_all() -> None:
    """素材的路径不许落到按方法兜住整个 platform 的那五条上。"""
    for path, method, _ in EXPECTED:
        rule = find_rule(catalog_rule_views(), path=path, method=method)
        assert rule is not None
        assert rule.permission_codes <= ASSET_CODES


def test_reading_never_needs_the_manage_code() -> None:
    """只读用户要看得到素材名。

    ⚠ 写兜底那条用的是 `*` 方法，它同样匹配 GET；读规则压不过去时，
    只读用户连素材库都打不开，而现象是一个空列表加一句 403。
    """
    for path in (ASSETS, f"{ASSETS}/kinds", ASSET):
        rule = find_rule(catalog_rule_views(), path=path, method="GET")
        assert rule is not None
        assert rule.permission_codes == VIEW
