"""结果面的两道契约：接口顶层键集，与块的花名册。

⚠ 块的**内部**形状没有 openapi 保护，键名写错时 typecheck、lint 与线形契约
全都放行——后端算了一年的混淆矩阵一个字没显示过就是这个机制。所以花名册要
写死在这里，前端那一半从同一张名单遍历
（docs/MODELING_RESULT_VIEW_DESIGN.md §10.2）。
"""

import json
from pathlib import Path

from platform_server.apps.modeling.operators import reporting
from platform_server.apps.modeling.schemas import NodeRunOut

SPEC = Path(__file__).resolve().parents[2] / "openapi.json"

# 节点详情的顶层键，写死一份。加字段必须同时改这里与前端那份键集
NODE_RUN_KEYS = {
    "node_id",
    "operator",
    "alias",
    "ordinal",
    "status",
    "duration_ms",
    "has_preview",
    "error_text",
    "preview",
    "is_preview_truncated",
    "exported_ports",
    "report",
    "fitted",
}

# 八种块，写死一份
EXPECTED_KINDS = (
    "rows",
    "columns",
    "cells",
    "fits",
    "bins",
    "axis",
    "breakdown",
    "structure",
)

# 五个区。⚠ 顺序即渲染顺序，别按字母排
EXPECTED_ZONES = ("step", "stats", "charts", "formula", "table")


def _schema(name: str) -> dict[str, object]:
    """从提交进仓的 openapi.json 里取一个模型的 schema。

    Args: name。
    """
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    schemas = spec["components"]["schemas"]
    found = schemas[name]
    assert isinstance(found, dict)
    return found


def test_the_node_detail_has_exactly_these_top_level_keys() -> None:
    """顶层键集写死：多一个少一个都要有人点头。"""
    assert set(NodeRunOut.model_fields) == NODE_RUN_KEYS


def test_the_exported_spec_matches_the_model() -> None:
    """openapi.json 与模型同步——不重导就会红在这里，而不是合进 main 才红。"""
    properties = _schema("NodeRunOut")["properties"]
    assert isinstance(properties, dict)
    assert set(properties) == NODE_RUN_KEYS


def test_the_block_kind_roster_is_the_one_we_wrote_down() -> None:
    """块的花名册逐字相等：前端派发表按它遍历，改名要两边一起改。"""
    assert reporting.BLOCK_KINDS == EXPECTED_KINDS


def test_the_zone_roster_keeps_its_declared_order() -> None:
    """区的花名册连顺序一起钉：顺序就是结果面从上到下的排法。"""
    assert reporting.ZONES == EXPECTED_ZONES


def test_every_kind_on_the_roster_has_a_constructor() -> None:
    """从花名册**反向**遍历：少一个构造函数的表现是那种块永远没人造得出来。"""
    for kind in reporting.BLOCK_KINDS:
        assert callable(getattr(reporting, f"{kind}_block"))


def test_the_tiers_are_three_and_only_three() -> None:
    """降档只有三档：加第四档要连着改预算那把梯子。"""
    tiers = (
        reporting.TIER_SCALAR,
        reporting.TIER_SMALL,
        reporting.TIER_LARGE,
    )
    assert tiers == (0, 1, 2)
