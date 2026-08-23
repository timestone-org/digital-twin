"""闸 1 对数据台账那 26 条 `/api/v1/platform` 路由的判定钉死。

⚠ 这一层守的是**顺序**。闸 1 首条命中即终局，而 `fnmatch` 的 `*` 跨斜杠，
所以 `dataset-tables*` 那一摞不压过 900 那五条按方法兜底的规则，就会变成
「持 `ac:manage` 的账号能删台账、只有 `dataset:*` 的账号一条都进不去」。
同一个道理在台账内部再来一遍：`records*` 的 `*` 同样跨斜杠，记录写的兜底会把
`GET …/records` 与 `…/records/{rid}/overrides` 一并吞进去，故读面与修正面各要
一条更高优先级的窄规则压回来。

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

RECORDS = f"{TABLE}/records"
RECORD = f"{RECORDS}/{SAMPLE_ID}"

VIEW = frozenset({catalog.DATASET_VIEW})
MANAGE = frozenset({catalog.DATASET_MANAGE})
RECORD_WRITE = frozenset({catalog.DATASET_RECORD_WRITE})
OVERRIDE = frozenset({catalog.DATASET_OVERRIDE})
BACKFILL = frozenset({catalog.DATASET_BACKFILL})
DATASET_CODES = VIEW | MANAGE | RECORD_WRITE | OVERRIDE | BACKFILL

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
    (RECORDS, "GET", VIEW),
    (RECORDS, "POST", RECORD_WRITE),
    (RECORD, "PATCH", RECORD_WRITE),
    (RECORD, "DELETE", RECORD_WRITE),
    (f"{RECORD}/overrides", "PUT", OVERRIDE),
    (f"{RECORD}/overrides", "DELETE", OVERRIDE),
    (f"{TABLE}/overrides:clear", "POST", OVERRIDE),
    (f"{TABLE}/latest", "GET", VIEW),
    (f"{TABLE}/series", "GET", VIEW),
    (f"{TABLE}:recompute", "POST", BACKFILL),
    (f"{TABLE}/backfill", "POST", BACKFILL),
    # ⚠ 查进度只要读面的码：看一眼进度的人不该顺带拿到改写历史的权限。
    # 这一条必须压过同路径那条 `*` 方法的写规则，反过来的话它会被一并吞掉
    (f"{TABLE}/backfill", "GET", VIEW),
    (f"{TABLE}/backfill", "DELETE", BACKFILL),
)

# 台账面对外端点的条数。写死是为了让「加了端点没加规则」在这里红
DATASET_ROUTE_COUNT = 26


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
    """只读角色拿得到 view，拿不到其余四个写档的码。"""
    viewer = frozenset(
        next(
            role for role in catalog.ROLES if role.name == catalog.ROLE_VIEWER
        ).codes
    )
    assert viewer >= VIEW
    assert viewer & (MANAGE | RECORD_WRITE | OVERRIDE | BACKFILL) == frozenset()


def test_reading_records_is_not_swallowed_by_the_record_write_fallback() -> (
    None
):
    """⚠ 记录写的兜底用的是 `records*` + `*` 方法，而 `*` 跨斜杠。

    读面不单独压过它的话，只读用户连一行数据都翻不出来——而现象是 403，
    看着像权限没配对，不像规则顺序写反了。
    """
    rule = find_rule(catalog_rule_views(), path=RECORDS, method="GET")
    assert rule is not None
    assert rule.permission_codes == VIEW


def test_writing_an_override_is_not_satisfied_by_the_record_write_code() -> (
    None
):
    """⚠ 人工修正落在 `records*` 的范围里，必须再压一级压回 override。

    压不回来的话，能录一行数据的人顺手就能改掉自动采集值——而那两件事的爆炸
    半径差一个量级（docs/DATASET_DESIGN.md §9）。
    """
    for method in ("PUT", "DELETE"):
        rule = find_rule(
            catalog_rule_views(), path=f"{RECORD}/overrides", method=method
        )
        assert rule is not None, method
        assert rule.permission_codes == OVERRIDE


def test_recompute_is_not_satisfied_by_the_table_manage_code() -> None:
    """⚠ 重算一次改写大批历史行并吃满数据库，与「改一列」不是同一类风险。"""
    rule = find_rule(
        catalog_rule_views(), path=f"{TABLE}:recompute", method="POST"
    )
    assert rule is not None
    assert rule.permission_codes == BACKFILL
