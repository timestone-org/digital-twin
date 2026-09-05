"""建模那一族共用的算料：拟合分、秩、每列口径、部分依赖、限深代表树。

⚠ 这一组反复验的是「算不出来给 None 不给 0」：R² 的分母为零、条件数无穷大、
占比的分母为零，三处印成 0 都会被读成一个真的数
（docs/MODELING_RESULT_VIEW_DESIGN.md §2-P4）。
"""

import math
import statistics
from collections.abc import Sequence
from typing import Any

import pytest

from platform_server.apps.modeling.operators.estimators import TreeEnsemble
from platform_server.apps.modeling.operators.modelstats import (
    MAX_TREE_NODES,
    TREE_DEPTH,
    as_aux,
    class_items,
    class_text,
    odds_ratio_of,
    pdp_curves,
    ranges_of,
    rank_check_of,
    scores_of,
    sigmas_of,
    tree_outline,
    with_notes,
)
from platform_server.apps.modeling.operators.reporting import (
    TIER_SCALAR,
    BlockAt,
    ReportBlock,
    Scale,
    breakdown_block,
)

KEYS = ("温度", "负荷")
# 一棵限深 3 的满树最多这么多节点：31 是块的硬上限，两者不是同一个数
FULL_TREE_NODES = 15
# 深到这一层就一定会撞上节点数上限，截断那一刻的取舍才看得见
DEEP_ENOUGH = 8


def a_block() -> ReportBlock:
    """一块最简单的讲解，挂载类的用例拿它当底。"""
    return breakdown_block(
        BlockAt(zone="stats", title="随便一块", tier=TIER_SCALAR),
        Scale(label="口径"),
        ({"name": "一项", "value": 1},),
    )


def rows_of(count: int) -> list[list[float]]:
    """两列的矩阵：第一列走 0,1,2…，第二列是它的十倍。

    Args: count。
    """
    return [[float(seat), float(seat) * 10.0] for seat in range(count)]


def test_the_scores_are_one_and_zero_when_the_prediction_is_exact() -> None:
    """预测与真值逐行相等：R² 是 1、RMSE 是 0。"""
    scores = scores_of([1.0, 2.0, 3.0], [1.0, 2.0, 3.0])
    assert scores.rows == 3
    assert scores.r2 == pytest.approx(1.0)
    assert scores.rmse == pytest.approx(0.0)


def test_the_scores_are_the_ordinary_textbook_numbers() -> None:
    """逐行差 0.5：SSE=1、SST=5，于是 R²=0.8、RMSE=0.5。"""
    scores = scores_of([1.0, 2.0, 3.0, 4.0], [1.5, 2.5, 2.5, 3.5])
    assert scores.r2 == pytest.approx(0.8)
    assert scores.rmse == pytest.approx(0.5)


def test_the_r2_is_none_when_the_target_never_moves() -> None:
    """目标列一点不变时 R² 的分母是零：那是算不出来，不是零。"""
    scores = scores_of([2.0, 2.0, 2.0], [2.0, 2.0, 1.0])
    assert scores.r2 is None
    assert scores.rmse == pytest.approx(math.sqrt(1 / 3))


def test_the_scores_refuse_two_columns_of_different_length() -> None:
    """长度对不上时两个数都给 None：按短的那截算会悄悄少算几行。"""
    scores = scores_of([1.0, 2.0], [1.0])
    assert scores.r2 is None
    assert scores.rmse is None


def test_the_rank_check_counts_the_intercept_column_too() -> None:
    """拟合截距时那一列常数也参与，故列数比特征数多一。"""
    check = rank_check_of(rows_of(5), use_intercept=True)
    assert check is not None
    assert check.columns == 3
    assert check.rank == 2
    assert check.is_deficient


def test_the_rank_check_calls_two_proportional_columns_deficient() -> None:
    """第二列是第一列的十倍：秩比列数少一，条件数无穷大故给 None。"""
    check = rank_check_of(rows_of(5), use_intercept=False)
    assert check is not None
    assert check.columns == 2
    assert check.rank == 1
    assert check.is_deficient
    assert check.condition is None


def test_the_rank_check_is_full_and_finite_on_independent_columns() -> None:
    """两列互不相关时满秩，条件数是一个有限的正数。"""
    check = rank_check_of(
        [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]], use_intercept=False
    )
    assert check is not None
    assert check.rank == 2
    assert not check.is_deficient
    assert check.condition is not None
    assert check.condition > 1.0


def test_the_rank_check_gives_none_on_an_empty_matrix() -> None:
    """一行都没有时给 None：印成「秩 0」会被读成「所有列都废了」。"""
    assert rank_check_of([], use_intercept=True) is None


def test_the_sigmas_are_population_deviations_column_by_column() -> None:
    """σ 按总体口径算，与 `statistics.pstdev` 逐列相等。"""
    rows = rows_of(5)
    spread = sigmas_of(rows, KEYS)
    assert spread["温度"] == pytest.approx(
        statistics.pstdev([0.0, 1.0, 2.0, 3.0, 4.0])
    )
    assert spread["负荷"] == pytest.approx(spread["温度"] * 10)


def test_the_ranges_are_the_two_edges_of_each_column() -> None:
    """每个特征的训练区间就是这一列的最小值与最大值。"""
    found = ranges_of(rows_of(5), KEYS)
    assert found == [
        {"key": "温度", "low": 0.0, "high": 4.0},
        {"key": "负荷", "low": 0.0, "high": 40.0},
    ]


def test_the_column_stats_say_nothing_when_there_is_nothing() -> None:
    """一行都没有、或者一列都没有时给空，不给一串 0。"""
    assert sigmas_of([], KEYS) == {}
    assert sigmas_of([[]], KEYS) == {}
    assert ranges_of([], KEYS) == []
    assert ranges_of([[]], KEYS) == []
    assert rank_check_of([[]], use_intercept=True) is None


def test_the_column_stats_stop_at_the_columns_the_matrix_really_has() -> None:
    """列名比矩阵宽时只答矩阵有的那几列：多出来的那个名字没有数。"""
    assert list(sigmas_of([[1.0], [3.0]], KEYS)) == [KEYS[0]]
    assert [item["key"] for item in ranges_of([[1.0], [3.0]], KEYS)] == [
        KEYS[0]
    ]


def test_the_class_items_list_a_class_that_never_shows_up() -> None:
    """一行都没摊上的类照列，值是 0：省掉它就看不出类不平衡。"""
    found = class_items([0.0, 0.0, 0.0], [0.0, 1.0])
    assert found == [
        {"name": "0", "value": 3, "ratio": 1.0},
        {"name": "1", "value": 0, "ratio": 0.0},
    ]


def test_the_class_ratio_is_none_when_there_are_no_rows() -> None:
    """一行都没有时占比是「算不出来」，不是 0。"""
    found = class_items([], [0.0, 1.0])
    assert found[0]["ratio"] is None


def test_the_class_text_drops_the_decimal_point_on_whole_numbers() -> None:
    """`1.0` 与 `1` 印成两样会被读成两个类。"""
    assert class_text(1.0) == "1"
    assert class_text(1.5) == "1.5"


def test_the_odds_ratio_is_the_exponential_of_the_coefficient() -> None:
    """β=0 时几率比是 1.0——那正是横条上的零线。"""
    assert odds_ratio_of(0.0) == pytest.approx(1.0)
    assert odds_ratio_of(1.0) == pytest.approx(math.e)


def test_the_odds_ratio_gives_none_instead_of_overflowing() -> None:
    """指数越过安全上限时给 None：inf 落进 JSON 是非法的。"""
    assert odds_ratio_of(800.0) is None
    assert odds_ratio_of(math.nan) is None


def summed(rows: Sequence[Sequence[float]]) -> list[float]:
    """一个当模型使的纯函数：预测值就是这一行各列之和。

    Args: rows。
    """
    return [sum(row) for row in rows]


def test_the_pdp_curve_follows_the_feature_it_moves() -> None:
    """只动第一列时曲线的斜率是 1：网格铺满这一列的区间，两端各一个点。"""
    curves = pdp_curves(summed, rows_of(20), KEYS, limit=1)
    assert len(curves) == 1
    points = curves[0].points
    assert len(points) == 20
    assert points[0][0] == pytest.approx(0.0)
    assert points[-1][0] == pytest.approx(19.0)
    assert points[-1][1] - points[0][1] == pytest.approx(19.0)


def test_the_pdp_curve_of_a_flat_column_is_a_single_point() -> None:
    """一列没有变化时铺不出网格：给一个点，不是给 20 个一模一样的点。"""
    curves = pdp_curves(summed, [[1.0, 2.0], [1.0, 5.0]], KEYS, limit=1)
    assert curves[0].points == [[1.0, pytest.approx(4.5)]]


def test_the_pdp_draws_nothing_when_there_is_nothing_to_draw() -> None:
    """一行都没有、或者一列都没有时不画曲线。"""
    assert pdp_curves(summed, [], KEYS) == []
    assert pdp_curves(summed, [[]], KEYS) == []


def test_the_pdp_stops_at_the_columns_the_matrix_really_has() -> None:
    """列名比矩阵宽时只画矩阵有的那几条。"""
    curves = pdp_curves(summed, [[1.0], [3.0]], KEYS)
    assert [curve.key for curve in curves] == [KEYS[0]]


def test_the_pdp_stops_at_the_number_of_curves_it_was_asked_for() -> None:
    """上限是几就画几条：再多的曲线读起来只是一团线。"""
    assert len(pdp_curves(summed, rows_of(8), KEYS, limit=1)) == 1
    assert len(pdp_curves(summed, rows_of(8), KEYS, limit=6)) == 2


def a_forest() -> TreeEnsemble:
    """一片在阶梯数据上长起来的森林。"""
    forest = TreeEnsemble(
        kind="forest", n_estimators=1, max_depth=None, random_state=0
    )
    rows = [[float(seat), float(seat % 3)] for seat in range(64)]
    forest.fit(rows, [float(seat % 8) for seat in range(64)])
    return forest


def test_the_tree_outline_stops_at_the_hard_depth() -> None:
    """限深 3 的满树最多 15 个节点，远在块的 31 个上限之内。"""
    outline = tree_outline(a_forest().estimator, KEYS)
    assert outline is not None
    assert outline["depth"] == TREE_DEPTH
    nodes = outline["nodes"]
    assert 0 < len(nodes) <= FULL_TREE_NODES
    assert len(nodes) <= MAX_TREE_NODES


def test_the_tree_outline_names_the_column_each_split_uses() -> None:
    """根节点没有父、带列名与阈值；截在深度上的那些一律当叶子。"""
    outline = tree_outline(a_forest().estimator, KEYS)
    assert outline is not None
    nodes = outline["nodes"]
    root = nodes[0]
    assert root["parent"] == -1
    assert root["key"] in KEYS
    assert root["threshold"] is not None
    assert not root["is_leaf"]
    leaves = [node for node in nodes if node["is_leaf"]]
    assert leaves
    assert all(node["key"] == "" for node in leaves)
    assert all(node["threshold"] is None for node in leaves)


def test_the_tree_outline_keeps_every_child_next_to_its_parent() -> None:
    """按层遍历：每个节点的父都已经在名单里，没有指向空处的枝。"""
    outline = tree_outline(a_forest().estimator, KEYS)
    assert outline is not None
    nodes = outline["nodes"]
    seen: set[int] = set()
    for node in nodes:
        assert node["parent"] == -1 or node["parent"] in seen
        assert node["branch"] in {"", "low", "high"}
        seen.add(int(node["id"]))


def levels_of(nodes: Any) -> list[int]:
    """每个节点在树上的第几层，按父子关系推。

    Args: nodes。
    """
    depths: dict[int, int] = {}
    made: list[int] = []
    for node in nodes:
        parent = int(node["parent"])
        level = 0 if parent == -1 else depths[parent] + 1
        depths[int(node["id"])] = level
        made.append(level)
    return made


def test_the_tree_outline_walks_level_by_level() -> None:
    """一层一层地走：层号只增不减。

    ⚠ 深度优先也满足「父在子之前」，但截断落在中途时留下的是一条深链——
    上面几层缺了一半，那棵树解释不通。
    """
    outline = tree_outline(a_forest().estimator, KEYS, depth=DEEP_ENOUGH)
    assert outline is not None
    levels = levels_of(outline["nodes"])
    assert len(levels) == MAX_TREE_NODES
    assert levels == sorted(levels)
    assert levels.count(0) == 1
    assert levels.count(1) == 2


def test_the_tree_outline_reaches_into_a_boosted_ensemble() -> None:
    """提升树的 `estimators_` 是每轮一排，比森林多套一层。"""
    boosted = TreeEnsemble(
        kind="gbdt", n_estimators=2, max_depth=2, random_state=0
    )
    rows = [[float(seat), float(seat % 3)] for seat in range(64)]
    boosted.fit(rows, [float(seat % 8) for seat in range(64)])
    outline = tree_outline(boosted.estimator, KEYS)
    assert outline is not None
    assert outline["nodes"]


def test_the_tree_outline_gives_none_when_there_is_no_tree_at_all() -> None:
    """拿不到树就说拿不到：造一棵空树出来是假数据。"""
    assert tree_outline(object(), KEYS) is None


def test_the_notes_ride_along_in_the_payload_of_that_very_block() -> None:
    """说的是哪一块的事就挂在哪一块上，空话不挂。"""
    made = with_notes(a_block(), ("要紧的一句", "", "另一句"))
    assert made.payload["notes"] == ["要紧的一句", "另一句"]
    assert "notes" not in with_notes(a_block(), ("", "")).payload


def test_the_aux_mark_is_the_only_thing_that_changes() -> None:
    """标成辅图只多一个键：块的种类、区与标题一个字都不动。"""
    plain = a_block()
    made = as_aux(plain)
    assert made.payload["is_primary"] is False
    assert made.kind == plain.kind
    assert made.zone == plain.zone
    assert made.title == plain.title
