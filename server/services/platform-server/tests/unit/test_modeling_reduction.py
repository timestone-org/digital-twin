"""特征筛选与主成分：排名 / 轴都在训练行上定，推理时回灌。

⚠ 这一组盯的是**目标列不许被动**：把它筛掉或压进主成分，下游切分就找不到要
预测的那一列了，而报错落在切分那一步上，读起来与这一步无关。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.operators.fitting import (
    PLAN_METHOD,
    PLAN_RANDOM_STATE,
    PLAN_TARGET,
    PLAN_TEST_RATIO,
)

STRONG = "有用的列"
WIDE = "量纲大的列"
TARGET = "能耗"
ROWS = 20

PLAN = {
    PLAN_TARGET: TARGET,
    PLAN_METHOD: "time_order",
    PLAN_TEST_RATIO: 0.2,
    PLAN_RANDOM_STATE: 0,
}


def _frame() -> Frame:
    """三列：与目标强相关的一列、量纲很大但无关的一列、目标列。"""
    rows = tuple(
        (
            float(index),
            float((index % 3) * 1000),
            float(index) * 2.0 + 1.0,
        )
        for index in range(ROWS)
    )
    return Frame(
        columns=(
            FrameColumn(key=STRONG, name=STRONG, dtype="number"),
            FrameColumn(key=WIDE, name=WIDE, dtype="number"),
            FrameColumn(key=TARGET, name=TARGET, dtype="number"),
        ),
        rows=rows,
    )


def _built(code: str, **config: Any) -> Any:
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=PLAN)
    return operator


def _ran(code: str, frame: Frame, **config: Any) -> Frame:
    produced = _built(code, **config).run({"frame": frame})["frame"]
    assert isinstance(produced, Frame)
    return produced


def test_selecting_by_correlation_keeps_the_column_that_matters() -> None:
    """按相关性筛时留下的是与目标相关的那一列，而不是量纲大的那一列。"""
    got = _ran("select_feature", _frame(), method="correlation", top_k=1)
    assert STRONG in got.keys
    assert WIDE not in got.keys


def test_selecting_by_variance_falls_for_the_unit() -> None:
    """按方差筛时留下的是量纲大的那一列——这正是算子说明里要讲的那条。"""
    got = _ran("select_feature", _frame(), method="variance", top_k=1)
    assert WIDE in got.keys


def test_the_target_column_is_never_selected_away() -> None:
    """目标列永远留着。

    ⚠ 筛掉它的话，下游切分会报「没有这一列」，而错误落在切分那一步上，
    读起来与这一步无关。
    """
    got = _ran("select_feature", _frame(), method="variance", top_k=1)
    assert TARGET in got.keys


def test_the_ranking_round_trips() -> None:
    """训出来的名单回灌得进去，收窄的结果一样。"""
    trained = _built("select_feature", method="correlation", top_k=1)
    trained.run({"frame": _frame()})
    served = _built("select_feature", method="correlation", top_k=1)
    served.load_fitted(trained.dump_fitted() or {})
    got = served.run({"frame": _frame()})["frame"]
    assert STRONG in got.keys
    assert WIDE not in got.keys


def test_a_ranking_with_duplicates_is_refused() -> None:
    """名单里有重复的列当场拒掉。"""
    with pytest.raises(OperatorError, match="重复"):
        _built("select_feature").load_fitted({"kept": [STRONG, STRONG]})


def test_pca_replaces_the_columns_with_components() -> None:
    """主成分把那几列换成 pc1…，目标列留着。"""
    got = _ran("pca", _frame(), n_components=1)
    assert got.keys == (TARGET, "pc1")


def test_the_axes_round_trip_and_project_the_same() -> None:
    """回灌轴之后投影出来的数与训练那一侧一致。"""
    trained = _built("pca", n_components=1)
    first = trained.run({"frame": _frame()})["frame"]
    served = _built("pca", n_components=1)
    served.load_fitted(trained.dump_fitted() or {})
    second = served.run({"frame": _frame()})["frame"]
    assert first.values_of("pc1") == pytest.approx(second.values_of("pc1"))


def test_axes_that_do_not_match_the_columns_are_refused() -> None:
    """轴的宽度与列数对不上时当场拒掉。

    ⚠ 不拦的话 `zip` 会截断，投影照样算得出来，只是每一列都错位了。
    """
    with pytest.raises(OperatorError, match="对不上"):
        _built("pca").load_fitted(
            {
                "columns": [STRONG, WIDE],
                "mean": [0.0, 0.0],
                "components": [[1.0]],
            }
        )


def test_asking_for_more_components_than_possible_is_refused() -> None:
    """要的主成分比数据给得出的还多时说清楚上限是多少。"""
    with pytest.raises(OperatorError, match="最多给得出"):
        _ran("pca", _frame(), n_components=5)


def test_both_declare_their_columns_as_unknowable() -> None:
    """两个的列声明都是「推不出来」——留哪几列取决于数据。"""
    for code in ("select_feature", "pca"):
        operator = registry.get(code)
        declared = operator.describe_columns(
            operator.CONFIG_MODEL(), {"frame": (STRONG, WIDE)}
        )
        assert declared["frame"] is None, code
