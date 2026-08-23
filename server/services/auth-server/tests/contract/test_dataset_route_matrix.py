"""闸 1 对数据台账那 13 条 `/api/v1/platform` 路由的判定钉死。

⚠ 这一层守的是**顺序**。闸 1 首条命中即终局，而 `fnmatch` 的 `*` 跨斜杠，
所以 `dataset-tables*` 的两条不压过 900 那五条按方法兜底的规则，就会变成
「持 `ac:manage` 的账号能删台账、只有 `dataset:*` 的账号一条都进不去」。

platform-server 的端点定义在另一个代码单元里，auth-server 看不见它的路由表，
因此这里按**文档化的端点清单**逐条断言（同 `test_collect_route_matrix.py`）。
"""

import pytest

from auth_server.apps.auth import catalog
from auth_server.apps.auth.services.matching import find_rule
from contract.rule_views import catalog_rule_views

PLATFORM_PREFIX = "/api/v1/platform"
SAMPLE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
TABLES = f"{PLATFORM_PREFIX}/dataset-tables"
TABLE = f"{TABLES}/{SAMPLE_ID}"
COLUMNS = f"{TABLE}/columns"

VIEW = frozenset({catalog.DATASET_VIEW})
MANAGE = frozenset({catalog.DATASET_MANAGE})
DATASET_CODES = VIEW | MANAGE

# 端点 → 期望的权限码。逐条复述 platform-server 的真实路由表。
EXPECTED: tuple[tuple[str, str, frozenset[str]], ...] = (
    (TABLES, "GET", VIEW),
    (TABLES, "POST", MANAGE),
    (TABLE, "GET", VIEW),
    (TABLE, "PATCH", MANAGE),
    (TABLE, "DELETE", MANAGE),
    (COLUMNS, "GET", VIEW),
    (COLUMNS, "POST", MANAGE),
    (f"{COLUMNS}:reorder", "POST", MANAGE),
    (f"{COLUMNS}/{SAMPLE_ID}", "PATCH", MANAGE),
    (f"{COLUMNS}/{SAMPLE_ID}", "DELETE", MANAGE),
    (f"{TABLE}/formula-functions", "GET", VIEW),
    (f"{TABLE}/formula:validate", "POST", MANAGE),
    (f"{TABLE}/formula:preview", "POST", MANAGE),
)

# 台账面对外端点的条数。写死是为了让「加了端点没加规则」在这里红
DATASET_ROUTE_COUNT = 13


def test_the_documented_face_covers_every_dataset_route() -> None:
    """⚠ 漏一条 platform 的端点，下面逐条那批就静默少测一条。"""
    assert len(EXPECTED) == DATASET_ROUTE_COUNT


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


def test_no_dataset_route_falls_through_to_the_hvac_catch_all() -> None:
    """台账的路径不许落到按方法兜住整个 platform 的那五条上。"""
    for path, method, _ in EXPECTED:
        rule = find_rule(catalog_rule_views(), path=path, method=method)
        assert rule is not None
        assert rule.permission_codes <= DATASET_CODES


def test_the_formula_catalog_is_readable_with_the_view_code_alone() -> None:
    """函数目录只是一份说明书，读它不该要改结构的权限。"""
    rule = find_rule(
        catalog_rule_views(), path=f"{TABLE}/formula-functions", method="GET"
    )
    assert rule is not None
    assert rule.permission_codes == VIEW


def test_reordering_columns_is_not_satisfied_by_the_read_code() -> None:
    """⚠ `columns:reorder` 是动作端点、是 POST，但它真的改数据。

    读面的动作端点（大屏 `:validate`、历史 `:aggregate`）都单列了窄规则放行，
    这一条**不许**跟着它们走——只读用户重排一次列，全表的表头就变了。
    """
    rule = find_rule(
        catalog_rule_views(), path=f"{COLUMNS}:reorder", method="POST"
    )
    assert rule is not None
    assert rule.permission_codes == MANAGE


def test_a_viewer_can_read_but_cannot_change_the_table_definition() -> None:
    """只读角色拿得到 view，拿不到 manage。"""
    viewer = frozenset(
        next(
            role for role in catalog.ROLES if role.name == catalog.ROLE_VIEWER
        ).codes
    )
    assert viewer >= VIEW
    assert not viewer >= MANAGE
