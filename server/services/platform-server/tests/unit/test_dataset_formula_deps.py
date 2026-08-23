"""依赖图与整表试编译：谁连边、谁不连边、成环怎么报。

⚠ 连边规则是全篇的重点：只有「同行引用」与「指向其它公式列的本表窗口引用」
连边。把 `PREV` 或自引用窗口也连上去，`{累计} = SUM_OVER({累计}, '1y')` 这种
合法写法会被判成自环（docs/DATASET_DESIGN.md §5.8）。
"""

import pytest

from platform_server.apps.dataset.formula import (
    ColumnFormula,
    ComputePlan,
    FormulaError,
    build_plan,
    topo_order,
)

KNOWN = {"甲", "乙", "丙", "录入"}


def plan_of(
    *columns: tuple[str, str], tables: frozenset[str] = frozenset()
) -> ComputePlan:
    """按 (列key, 公式) 若干对编译整张表。

    Args: columns, tables。
    """
    entries = [
        ColumnFormula(key=key, name=key, formula=formula)
        for key, formula in columns
    ]
    keys = KNOWN | {key for key, _ in columns}
    return build_plan(entries, keys, known_tables=tables)


def test_a_hand_rolled_plan_is_refused() -> None:
    # ⚠ 手搓一个等于手抄「哪些相位是必需的」，而每一处遗漏都表现为一列静默算空
    with pytest.raises(TypeError, match="build_plan"):
        ComputePlan(object())


def test_an_empty_table_compiles_to_an_empty_plan() -> None:
    assert plan_of().is_empty is True


def test_dependencies_are_evaluated_before_the_columns_that_read_them() -> None:
    plan = plan_of(("丙", "{乙} + 1"), ("乙", "{甲} + 1"))
    assert plan.order == ["乙", "丙"]


def test_the_order_is_reproducible_across_runs() -> None:
    first = plan_of(("乙", "1"), ("甲", "2"), ("丙", "3")).order
    second = plan_of(("丙", "3"), ("甲", "2"), ("乙", "1")).order
    assert first == second == ["丙", "乙", "甲"]


def test_a_self_reference_is_a_cycle() -> None:
    # ⚠ 自环不豁免
    with pytest.raises(FormulaError, match="循环引用：甲"):
        plan_of(("甲", "{甲} + 1"))


def test_two_columns_reading_each_other_are_a_cycle() -> None:
    with pytest.raises(FormulaError, match="循环引用：乙 → 甲"):
        plan_of(("甲", "{乙} + 1"), ("乙", "{甲} + 1"))


def test_a_window_pointing_at_another_formula_column_is_an_edge() -> None:
    plan = plan_of(("甲", "SUM_OVER({乙}, '1h')"), ("乙", "1"))
    assert plan.order == ["乙", "甲"]


def test_two_columns_windowing_each_other_are_a_cycle() -> None:
    # 各自都要对方在**当前行**上的值
    with pytest.raises(FormulaError, match="循环引用"):
        plan_of(("甲", "SUM_OVER({乙}, '1h')"), ("乙", "SUM_OVER({甲}, '1h')"))


def test_a_window_over_its_own_column_is_not_a_cycle() -> None:
    # 当前行还没算出这一列的值，故它不贡献进自己的窗口
    assert plan_of(("甲", "SUM_OVER({甲}, '1y') + 1")).order == ["甲"]


def test_a_window_over_an_input_column_draws_no_edge() -> None:
    assert plan_of(("甲", "SUM_OVER({录入}, '1h')")).order == ["甲"]


def test_two_columns_reading_each_other_s_earlier_rows_are_legal() -> None:
    # `PREV` 读的是别的行，不构成同一行内的先后关系
    plan = plan_of(("甲", "PREV({乙})"), ("乙", "PREV({甲})"))
    assert sorted(plan.order) == ["乙", "甲"]


def test_a_whole_column_aggregate_draws_no_edge() -> None:
    plan = plan_of(("甲", "SUM_ALL({乙})"), ("乙", "SUM_ALL({甲})"))
    assert sorted(plan.order) == ["乙", "甲"]


def test_a_cross_table_window_draws_no_edge_even_on_a_name_collision() -> None:
    plan = plan_of(
        ("甲", "SUM_OVER({src.甲}, '1h')"), tables=frozenset({"src"})
    )
    assert plan.order == ["甲"]


def test_a_broken_column_is_reported_without_failing_the_whole_table() -> None:
    # ⚠ 一次 force 删列会让引用它的那几列同时坏掉；整表随之编不过的话，用户
    # 连挨个修都做不到——每改一列都会被别的坏列挡回来
    plan = plan_of(("甲", "{不存在} + 1"), ("乙", "{甲} + 1"))
    assert plan.order == ["乙"]
    assert "甲" in plan.failures
    assert "列「甲」的公式有误" in plan.failures["甲"]


def test_an_unknown_table_code_is_reported_against_that_column() -> None:
    plan = plan_of(("甲", "{nope.x} + 1"))
    assert "引用了不存在的台账：nope" in plan.failures["甲"]


def test_a_known_table_code_compiles() -> None:
    plan = plan_of(("甲", "{src.x} + 1"), tables=frozenset({"src"}))
    assert plan.failures == {}


def test_the_plan_gathers_every_reference_kind_for_the_fetch_phase() -> None:
    plan = plan_of(
        ("甲", "PREV({乙}) + SUM_OVER({乙}, '1h') + SUM_ALL({乙}) + {src.x}"),
        tables=frozenset({"src"}),
    )
    assert len(plan.prev_refs) == 1
    assert len(plan.window_refs) == 1
    assert len(plan.whole_refs) == 1
    assert len(plan.external_refs) == 1
    assert plan.external_table_codes == {"src"}


def test_a_table_with_no_history_reference_needs_no_history() -> None:
    assert plan_of(("甲", "{乙} + 1")).needs_history is False


def test_any_history_reference_makes_the_table_need_history() -> None:
    assert plan_of(("甲", "PREV({乙})")).needs_history is True


def test_only_a_local_whole_column_aggregate_widens_to_the_whole_table() -> (
    None
):
    # ⚠ 往本表写一行不会改变对方表的聚合值
    assert plan_of(("甲", "SUM_ALL({乙})")).needs_whole is True
    assert (
        plan_of(
            ("甲", "SUM_ALL({src.x})"), tables=frozenset({"src"})
        ).needs_whole
        is False
    )


def test_an_edge_pointing_outside_the_formula_columns_is_not_an_edge() -> None:
    assert topo_order({"甲": {"录入"}}, {"甲"}) == ["甲"]


def test_the_cycle_message_names_every_column_it_could_not_order() -> None:
    # 按码位排序，与运行环境的 locale 无关——报错文案在哪台机器上都一样
    with pytest.raises(FormulaError, match="丙 → 乙 → 甲"):
        topo_order(
            {"甲": {"乙"}, "乙": {"丙"}, "丙": {"甲"}}, {"甲", "乙", "丙"}
        )
