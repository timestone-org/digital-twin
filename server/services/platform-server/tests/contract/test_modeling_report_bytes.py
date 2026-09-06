"""规格 §10.2 契约 #4：24 个算子在各自**最坏**的一份负载上都还讲得下。

从算子花名册反向遍历，逐个把各块的逐列 / 逐项上限顶满真跑一遍。契约 #2 喂的是
最小输入，挡不住宽帧 / 366 天轴 / 20 类 / 20 折 / 深树这一头——缺了这一条，第
25 个算子不写最坏字节用例也全闸绿（docs/MODELING_RESULT_VIEW_DESIGN.md §10.2）。
"""

from functools import cache
from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    Provenance,
    ReportBlock,
    registry,
)
from platform_server.apps.modeling.operators.base import PREFETCHED_KEY
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    DTYPE_STRING,
    ROLE_TARGET,
)
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import (
    PREVIEW_MAX_BYTES,
    REPORT_MAX_BYTES,
    fit_budget,
    size_of,
    summarize,
)

HOUR_MS = 3_600_000
# 摘要的列上限是 60，讲解里每一张按列摊开的表上限也是 60：宽到这里就全顶格了
WIDE_COLUMNS = 60
# 366 天逐时——时间轴那一档的最坏跨度
YEAR_ROWS = 366 * 24
# 混淆矩阵的最坏边长
CLASSES = 20
# 折数的配置上限
FOLDS = 20
# 每列的类目数上限
CATEGORIES = 200
# 文本列摆到「逐列表」的 12 列上限，转不动的格与类型对照才顶得到格
TEXT_COLUMNS = 12
# 树深的配置上限
TREE_DEPTH = 40
# 时间特征的全部档位，一档都不少
TIME_PARTS = ("hour", "dayofweek", "month", "dayofyear", "is_weekend")
# 建模那几路吃的行数：拟合与置换重要性按行数线性变慢，而讲解的字节与行数无关
FIT_ROWS = 2000
# 评估那几路的打分行数
SCORED_ROWS = 4000
TARGET = "全厂综合能耗折标煤合计读数"
# 造不出最坏负载、只好放过的算子。⚠ 这份名单必须一直是空的：往里加一个名字
# 等于把那个算子移出这道闸
UNREACHABLE: tuple[str, ...] = ()

#: 一份最坏负载 = `(端口负载, 算子参数)`
type Case = tuple[dict[str, Any], dict[str, Any]]


def _key(seat: int) -> str:
    """一个现场那么长的列名。⚠ 名字长度是唯一没有上限的那一维，讲解按它逐字
    带走，故最坏负载按现场最长的那一类命名（规格 §7 的长列名口径）。

    Args: seat。
    """
    return f"{seat}号冷冻水泵出口温度传感器读数"


def _cell(row: int, seat: int, *, is_dense: bool) -> CellValue:
    """一格取值。小数位摆满——短小数会让整份摘要凭空瘦一圈。

    每 500 行摆一个离群值：不摆的话裁剪算子一格都夹不到，它那张「改了多少个数」
    的表就是空的，最坏负载在那一块上根本没顶到格。
    Args: row, seat, is_dense（不留空格）。
    """
    if not is_dense and (row + seat) % 37 == 0:
        return None
    if row % 500 == 0:
        return 9000.0 + seat * 13.7 + row * 0.000123456
    return float((row * 7 + seat * 13) % 971) + (row % 5) * 0.123456789


def _moments(rows: int, *, has_gaps: bool) -> tuple[int, ...]:
    """逐时时刻；`has_gaps` 时每 100 行断开十小时，把断档表撑满。

    Args: rows, has_gaps。
    """
    stride = 10 * HOUR_MS if has_gaps else 0
    return tuple(row * HOUR_MS + (row // 100) * stride for row in range(rows))


def _numeric(
    rows: int,
    *,
    is_dense: bool = False,
    has_gaps: bool = False,
    empty_tail: int = 0,
) -> Frame:
    """一份 60 列宽帧：长中文列名、带单位、逐列都有转不动的格。

    Args: rows, is_dense, has_gaps, empty_tail（末尾整列全空的列数）。
    """
    columns = tuple(
        FrameColumn(
            key=_key(seat),
            name=_key(seat),
            dtype=DTYPE_NUMBER,
            unit="千瓦时",
            coerce_failed=3,
        )
        for seat in range(WIDE_COLUMNS)
    )
    empty_from = WIDE_COLUMNS - empty_tail
    body = tuple(
        tuple(
            None if seat >= empty_from else _cell(row, seat, is_dense=is_dense)
            for seat in range(WIDE_COLUMNS)
        )
        for row in range(rows)
    )
    return Frame(
        columns=columns,
        rows=body,
        index=_moments(rows, has_gaps=has_gaps),
        provenance=Provenance(table_codes=("energy_h",), is_truncated=True),
    )


def _roled(frame: Frame) -> Frame:
    """把最后一列改成目标列并填满它——训练不吃有空值的目标列。

    Args: frame。
    """
    last = len(frame.columns) - 1
    target = FrameColumn(
        key=TARGET, name=TARGET, dtype=DTYPE_NUMBER, role=ROLE_TARGET
    )
    columns = tuple(
        target if seat == last else column
        for seat, column in enumerate(frame.columns)
    )
    body = tuple(
        (*cells[:last], float(seat * 3 % 517) + 1.0)
        for seat, cells in enumerate(frame.rows)
    )
    return Frame(
        columns=columns,
        rows=body,
        index=frame.index,
        provenance=frame.provenance,
    )


def _labelled(frame: Frame) -> Frame:
    """目标列换成 0/1，逻辑回归拿它训。

    Args: frame。
    """
    last = len(frame.columns) - 1
    body = tuple(
        (*row[:last], 1.0 if (row[0] or 0.0) > 480.0 else 0.0)
        for row in frame.rows
    )
    return Frame(
        columns=frame.columns,
        rows=body,
        index=frame.index,
        provenance=frame.provenance,
    )


def _categorical(rows: int, cols: int) -> Frame:
    """一份文本帧：每列 200 个长名字类目，独热与类型归一都拿它顶格。

    Args: rows, cols。
    """
    columns = tuple(
        FrameColumn(key=_key(seat), name=_key(seat), dtype=DTYPE_STRING)
        for seat in range(cols)
    )
    body = tuple(
        tuple(
            f"{(row * (seat + 3)) % CATEGORIES}号机组白班检修工况"
            for seat in range(cols)
        )
        for row in range(rows)
    )
    return Frame(
        columns=columns, rows=body, index=_moments(rows, has_gaps=False)
    )


def _scored(rows: int, *, classes: int = 0, has_proba: bool = False) -> Frame:
    """一份打分帧。`classes` 给多分类，`has_proba` 多带一列正类概率。

    Args: rows, classes, has_proba。
    """
    columns = [
        FrameColumn(key="y_true", name="真实值", dtype=DTYPE_NUMBER),
        FrameColumn(key="y_pred", name="预测值", dtype=DTYPE_NUMBER),
    ]
    if has_proba:
        columns.append(
            FrameColumn(key="y_proba", name="正类概率", dtype=DTYPE_NUMBER)
        )
    body = tuple(
        _scored_row(row, classes=classes, has_proba=has_proba)
        for row in range(rows)
    )
    return Frame(
        columns=tuple(columns),
        rows=body,
        index=_moments(rows, has_gaps=False),
    )


def _scored_row(
    row: int, *, classes: int, has_proba: bool
) -> tuple[CellValue, ...]:
    """打分帧的一行。概率那一路把 1000 个不同的概率值都摆出来。

    Args: row, classes, has_proba。
    """
    if classes:
        return (float(row % classes), float(row * 7 // 3 % classes))
    if has_proba:
        chance = (row * 37 % 1000) / 1000.0
        return (float(row % 2), 1.0 if chance >= 0.5 else 0.0, chance)
    return (float(row) + 0.5, float(row) * 1.001 - 0.7)


@cache
def frames() -> dict[str, Frame]:
    """全部最坏帧只造一份，逐个负载共用。

    ⚠ 共用是有意的：新算子想蒙混过关就得动这里，而动了这里全部 24 条一起响。
    """
    trained = _roled(_numeric(FIT_ROWS, is_dense=True))
    return {
        "wide": _numeric(YEAR_ROWS),
        "gapped": _numeric(YEAR_ROWS, has_gaps=True),
        "hollow": _numeric(SCORED_ROWS, empty_tail=WIDE_COLUMNS - TEXT_COLUMNS),
        "narrow": _numeric(FIT_ROWS // 2),
        "roled": _roled(_numeric(YEAR_ROWS)),
        "is_dense": trained,
        "long_dense": _roled(_numeric(YEAR_ROWS, is_dense=True)),
        "labelled": _labelled(trained),
        "categorical": _categorical(FIT_ROWS, TEXT_COLUMNS),
        "regression_scored": _scored(SCORED_ROWS),
        "class_scored": _scored(SCORED_ROWS, classes=CLASSES),
        "proba_scored": _scored(SCORED_ROWS, has_proba=True),
    }


@cache
def _trained() -> object:
    """在最坏训练帧上训一个线性回归，交叉验证与置换重要性拿它当上游。"""
    operator, _ = registry.build("linear_regression", {})
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    return operator.run(
        {"train": frames()["is_dense"], "test": frames()["is_dense"]}
    )["model"]


def _every_key() -> list[str]:
    """宽帧的全部 60 个列 key。"""
    return [_key(seat) for seat in range(WIDE_COLUMNS)]


def _source_loads() -> dict[str, tuple[Case, ...]]:
    """取数与对齐的最坏负载。"""
    pool = frames()
    return {
        "ledger_join": (
            (
                {"left": pool["wide"], "right": pool["narrow"]},
                {"how": "left", "tolerance_ms": HOUR_MS},
            ),
        ),
        "ledger_source": (
            (
                {PREFETCHED_KEY: pool["hollow"]},
                {
                    "table_code": "energy_hourly",
                    "columns": _every_key(),
                    "should_drop_empty_columns": True,
                },
            ),
        ),
    }


def _preprocess_loads() -> dict[str, tuple[Case, ...]]:
    """清洗那六个算子的最坏负载。"""
    pool = frames()
    every = _every_key()
    return {
        "cast_type": (
            (
                {"frame": pool["categorical"]},
                {
                    "columns": every[:TEXT_COLUMNS],
                    "to": "number",
                    "on_error": "coerce",
                },
            ),
        ),
        "clip_outlier": (
            (
                {"frame": pool["wide"]},
                {"method": "iqr", "threshold": 1.5, "columns": every},
            ),
        ),
        "drop_missing": (
            (
                {"frame": pool["hollow"]},
                {"axis": "col", "how": "any", "subset": every},
            ),
        ),
        "fill_missing": (
            ({"frame": pool["wide"]}, {"strategy": "mean", "columns": every}),
        ),
        "filter_rows": (
            (
                {"frame": pool["wide"]},
                {"column": _key(0), "op": "gte", "value": 500.0},
            ),
        ),
        "resample": (
            ({"frame": pool["gapped"]}, {"bucket": "1m", "agg": "avg"}),
        ),
    }


def _feature_loads() -> dict[str, tuple[Case, ...]]:
    """造特征那七个算子的最坏负载。"""
    pool = frames()
    every = _every_key()
    return {
        "lag_feature": (
            ({"frame": pool["wide"]}, {"columns": every, "lags": [1, 2, 3]}),
        ),
        "one_hot": (
            (
                {"frame": pool["categorical"]},
                {
                    "columns": every[:TEXT_COLUMNS],
                    "max_categories": CATEGORIES,
                    "on_many_categories": "keep_top",
                },
            ),
        ),
        "pca": (
            (
                {"frame": pool["long_dense"]},
                {"n_components": WIDE_COLUMNS - 1},
            ),
        ),
        "rolling_feature": (
            (
                {"frame": pool["narrow"]},
                {
                    "columns": every,
                    "window": 50,
                    "stats": ["mean", "sum", "min", "max", "std"],
                },
            ),
        ),
        "select_feature": (
            (
                {"frame": pool["long_dense"]},
                {"method": "correlation", "top_k": 500},
            ),
        ),
        "standardize": (
            ({"frame": pool["wide"]}, {"method": "zscore", "columns": every}),
        ),
        "time_feature": (
            ({"frame": pool["wide"]}, {"parts": list(TIME_PARTS)}),
        ),
    }


def _model_loads() -> dict[str, tuple[Case, ...]]:
    """切分与三个建模算子的最坏负载。"""
    pool = frames()
    return {
        "linear_regression": (
            (
                {"train": pool["is_dense"], "test": pool["is_dense"]},
                {"regularization": "ridge"},
            ),
        ),
        "logistic_regression": (
            ({"train": pool["labelled"], "test": pool["labelled"]}, {}),
        ),
        "split_dataset": (
            (
                {"frame": pool["roled"]},
                {"target_column": TARGET, "test_ratio": 0.3},
            ),
        ),
        "tree_regressor": (
            (
                {"train": pool["is_dense"], "test": pool["is_dense"]},
                {"shape": "forest", "n_estimators": 3, "max_depth": TREE_DEPTH},
            ),
        ),
    }


def _evaluate_loads() -> dict[str, tuple[Case, ...]]:
    """五个评估算子的最坏负载。分类那一路有两种最坏形状，两份都算。"""
    pool = frames()
    fitted = {"model": _trained()}
    return {
        "classification_metrics": (
            ({"scored": pool["class_scored"]}, {"positive_label": 3.0}),
            ({"scored": pool["proba_scored"]}, {"positive_label": 1.0}),
        ),
        "cross_validate": (
            (
                fitted | {"frame": pool["is_dense"]},
                {"folds": FOLDS, "method": "kfold"},
            ),
        ),
        "feature_importance": (
            (fitted | {"test": pool["is_dense"]}, {"repeats": 2}),
        ),
        "regression_metrics": (
            (
                {"scored": pool["regression_scored"]},
                {"residual_bins": 100, "max_scatter_points": 5000},
            ),
        ),
        "residual_analysis": (
            ({"scored": pool["regression_scored"]}, {"bins": 100}),
        ),
    }


@cache
def loads() -> dict[str, tuple[Case, ...]]:
    """全部算子的最坏负载表。一个 code 可以有不止一份最坏形状。"""
    return {
        **_source_loads(),
        **_preprocess_loads(),
        **_feature_loads(),
        **_model_loads(),
        **_evaluate_loads(),
    }


@cache
def ran(code: str) -> tuple[tuple[tuple[ReportBlock, ...], list[Any]], ...]:
    """按最坏负载逐份跑一遍，回 `(讲解块, 各端口负载)`。

    Args: code。
    """
    done: list[tuple[tuple[ReportBlock, ...], list[Any]]] = []
    for inputs, config in loads()[code]:
        operator, _ = registry.build(code, config)
        operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
        outputs = operator.run(dict(inputs))
        done.append((operator.report(), list(outputs.values())))
    return tuple(done)


CODES = registry.codes()


def test_every_registered_operator_has_a_worst_load_here() -> None:
    """反向遍历的入口：花名册上多一个算子，这张表就得跟着多一行。"""
    assert set(loads()) == set(CODES) - set(UNREACHABLE)
    assert UNREACHABLE == ()
    assert len(CODES) == 24


def test_the_shared_frames_really_are_the_worst_ones() -> None:
    """夹具自身的分辨力：把宽帧改窄、把轴改短，这一条先红。

    ⚠ 没有它，往下加一个算子的人只要塞一份三列小帧就能让最坏字节全绿。
    """
    pool = frames()
    assert len(pool["wide"].columns) == WIDE_COLUMNS
    assert pool["wide"].row_count == YEAR_ROWS
    assert len(pool["gapped"].columns) == WIDE_COLUMNS
    assert len({row[0] for row in pool["class_scored"].rows}) == CLASSES
    assert len({row[2] for row in pool["proba_scored"].rows}) > CLASSES
    assert loads()["cross_validate"][0][1]["folds"] == FOLDS
    assert loads()["tree_regressor"][0][1]["max_depth"] == TREE_DEPTH


def test_every_worst_load_is_fed_one_of_the_shared_frames() -> None:
    """每一份负载都吃共用的那几份最坏帧，且没有一份帧是白造的。"""
    pool = frames()
    used: set[str] = set()
    for cases in loads().values():
        for inputs, _ in cases:
            for value in inputs.values():
                if not isinstance(value, Frame):
                    continue
                names = [name for name, one in pool.items() if one is value]
                assert names != []
                used.update(names)
    assert used == set(pool)


@pytest.mark.parametrize("code", CODES)
def test_the_worst_report_keeps_every_block_inside_the_node_budget(
    code: str,
) -> None:
    """最坏负载上一块都不该被降档丢掉，整份讲解也在单节点上限之内。

    ⚠ 这是契约 #2 挡不住的那一头：那一条喂的是最小输入，宽帧 / 长轴 / 20 类 /
    20 折 / 深树把上限顶满之后才看得出某个块的上限是不是配大了。
    """
    for blocks, _ in ran(code):
        report = report_budget.fit_report(blocks)
        assert report is not None
        assert report["dropped"] == []
        assert report["note"] == ""
        assert report_budget.size_of(report) < REPORT_MAX_BYTES


@pytest.mark.parametrize("code", CODES)
def test_the_worst_preview_never_loses_a_key_to_the_byte_budget(
    code: str,
) -> None:
    """最坏负载上摘要只许削行，不许摘键。

    ⚠ 摘键是无声的：`pairs` 被摘掉而 `pairs_truncated` 留着，界面上就是少一张
    图且一个字都没说（规格 §1.3 的 D-8）。
    """
    for _, payloads in ran(code):
        for payload in payloads:
            preview = summarize(payload)
            fitted, _ = fit_budget(preview)
            assert size_of(fitted) <= PREVIEW_MAX_BYTES
            assert set(fitted) == set(preview)
