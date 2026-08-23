"""降级路径：读不动、渲染不出来的时候说「不知道」，绝不 500。

⚠ 校验端点只要读权限就能调。渲染器上的一个 `RecursionError` 打成 500，等于把
一个显示问题升级成一次故障（docs/DATASET_DESIGN.md §5.9、§7.13）。
"""

from typing import Any

import pytest

from platform_server.apps.dataset.formula import ExternalKey, parse_formula
from platform_server.apps.dataset.models import DatasetColumn
from platform_server.apps.dataset.services import formula_service
from platform_server.apps.dataset.services.formula_cycles import (
    check_no_cycle,
)
from platform_server.apps.dataset.services.presenters import to_deps_out


def a_column(**values: Any) -> DatasetColumn:
    """造一列不入库的列定义。"""
    return DatasetColumn(
        table_id=None,
        key=values.get("key", "甲"),
        name=values.get("key", "甲"),
        data_type="number",
        source=values.get("source", "formula"),
        agg="avg",
        order_index=0,
        is_required=False,
        formula=values.get("formula"),
        formula_deps=values.get("formula_deps"),
    )


def test_a_dependency_blob_that_will_not_read_becomes_no_blob() -> None:
    # 那一列的公式原文还在，界面照常显示得出来，只是少一份依赖清单
    assert to_deps_out({"same_row": "不是个列表"}) is None


@pytest.mark.parametrize("blob", [None, "字符串", 42, []])
def test_a_blob_that_is_not_an_object_becomes_no_blob(blob: Any) -> None:
    assert to_deps_out(blob) is None


def test_a_well_formed_blob_reads_back() -> None:
    parsed = parse_formula("{a} + PREV({b})")
    assert to_deps_out(parsed.deps.to_json()) is not None


@pytest.mark.parametrize(
    "blob",
    [
        {},
        {"same_row": "不是个列表"},
        {"window": "不是个列表"},
        {"window": ["不是个对象"]},
        {"same_row": [1, 2]},
    ],
)
def test_a_malformed_blob_contributes_no_edges_instead_of_crashing(
    blob: dict[str, Any],
) -> None:
    # 只有绕过接口直接改库才会走到这里；崩掉的话，一张表从此连列都改不了
    columns = [a_column(key="甲", formula_deps=blob)]
    # 契约就是「不抛」——崩掉的话，一张表从此连列都改不了
    deps = parse_formula("1").deps
    assert check_no_cycle(columns, key="乙", deps=deps) is None


def test_a_column_that_is_not_a_formula_column_draws_no_edges() -> None:
    columns = [a_column(key="甲", source="manual")]
    deps = parse_formula("{甲} + 1").deps
    assert check_no_cycle(columns, key="乙", deps=deps) is None


def test_a_renderer_failure_leaves_the_verdict_intact(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # ⚠ 「这条公式对不对」与「画不画得出来」是两个问题，后者不许影响前者
    def explode(*_args: object, **_kwargs: object) -> dict[str, Any]:
        raise RecursionError

    monkeypatch.setattr(formula_service, "to_notation", explode)
    assert formula_service._render(parse_formula("{a} + 1"), []) == (
        None,
        None,
    )


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        (("prev", "能耗", 1), "PREV({能耗})"),
        (("prev", "能耗", 3), "PREV({能耗}, 3)"),
        (("win", "SUM_OVER", "产量", "3mo"), "SUM_OVER({产量}, '3mo')"),
        (("all", "AVG_ALL", "能耗"), "AVG_ALL({能耗})"),
        (("ext", "src", "基准"), "{src.基准}"),
    ],
)
def test_a_prefetch_key_reads_back_as_something_the_user_could_have_typed(
    key: ExternalKey, expected: str
) -> None:
    assert formula_service._describe(key) == expected


@pytest.mark.parametrize("source", ["{a} + {b}", "{a} + {b} + {c}", "{a} + 1"])
def test_a_pure_addition_is_recognised(source: str) -> None:
    assert formula_service._is_pure_addition(parse_formula(source)) is True


@pytest.mark.parametrize(
    "source",
    [
        "{a} - {b}",
        "{a} * {b}",
        "{a} / {b}",
        "SUM({a}, {b})",
        "-{a} + {b}",
        "IF({a} > 0, {a}, {b})",
        "{a} + {b} if {c} else 0",
        "({a} > 0) and ({b} > 0)",
        "{a} > {b}",
    ],
)
def test_anything_but_a_pure_addition_gets_no_skip_missing_advice(
    source: str,
) -> None:
    # 减 / 乘 / 除那里的空才是正确答案，劝人换写法就是劝人把它换成一个错的数
    assert formula_service._is_pure_addition(parse_formula(source)) is False
