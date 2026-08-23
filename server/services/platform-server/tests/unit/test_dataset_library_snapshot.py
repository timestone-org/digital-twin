"""库快照的装配：一行库表 → 引擎条目，以及那道省查询的 `@` 闸。"""

from typing import Any

from platform_server.apps.dataset.formula import PARAM_COLUMN, PARAM_VALUE
from platform_server.apps.dataset.models import DatasetColumn, DatasetFormula
from platform_server.apps.dataset.services.formula_library import (
    entry_of,
    params_to_json,
    uses_library,
)


def row(**overrides: Any) -> DatasetFormula:
    """一条最小可用的库公式行。

    Args: overrides。
    """
    values: dict[str, Any] = {
        "code": "占比",
        "name": "占比",
        "category": "basic",
        "expression": "{部分} / {整体} * 100",
        "params_json": [
            {"name": "部分", "kind": PARAM_COLUMN},
            {"name": "整体", "kind": PARAM_VALUE, "default": 1},
        ],
        "description": None,
        "is_builtin": False,
        "is_enabled": True,
    }
    values.update(overrides)
    return DatasetFormula(**values)


def column(**overrides: Any) -> DatasetColumn:
    """一列。只用到 `source` 与 `formula` 两项。

    Args: overrides。
    """
    values: dict[str, Any] = {"source": "formula", "formula": "{a} + 1"}
    values.update(overrides)
    return DatasetColumn(**values)


def test_a_row_becomes_the_entry_the_engine_expects() -> None:
    entry = entry_of(row())
    assert entry.signature() == "@占比(部分, 整体)"
    assert entry.params[1].kind == PARAM_VALUE
    assert entry.params[1].default == 1


def test_a_disabled_row_keeps_its_flag_in_the_snapshot() -> None:
    # ⚠ 停用的条目照样装进快照，报错才说得出「已停用」而不是「库里没有 X」
    assert entry_of(row(is_enabled=False)).is_enabled is False


def test_a_broken_parameter_is_skipped_rather_than_failing_the_load() -> None:
    # ⚠ 一条形参写坏就加载不出公式库，等于每张台账的每个公式列一起算不出数
    entry = entry_of(
        row(params_json=[{"name": "部分"}, "坏掉的一项", {"kind": "column"}])
    )
    assert [param.name for param in entry.params] == ["部分"]


def test_a_parameter_without_a_kind_falls_back_to_column() -> None:
    entry = entry_of(row(params_json=[{"name": "部分"}]))
    assert entry.params[0].kind == PARAM_COLUMN


def test_the_stored_shape_round_trips() -> None:
    assert params_to_json(entry_of(row()).params) == [
        {
            "name": "部分",
            "kind": PARAM_COLUMN,
            "label": "",
            "hint": "",
            "default": None,
        },
        {
            "name": "整体",
            "kind": PARAM_VALUE,
            "label": "",
            "hint": "",
            "default": 1,
        },
    ]


def test_a_table_without_any_call_skips_the_query() -> None:
    assert uses_library([column(), column(formula="{b} * 2")]) is False


def test_one_call_anywhere_is_enough() -> None:
    assert uses_library([column(), column(formula="@占比({a}, 1)")]) is True


def test_the_draft_under_validation_counts_too() -> None:
    # 这张表现在一条库公式都没用，但正在保存的这一列用了
    assert uses_library([column()], extra="@占比({a}, 1)") is True


def test_a_stale_formula_on_a_manual_column_does_not_count() -> None:
    # ⚠ 只看公式列：来源改回人工录入之后那段公式已经不参与计算了
    stale = column(source="manual", formula="@占比({a}, 1)")
    assert uses_library([stale]) is False
