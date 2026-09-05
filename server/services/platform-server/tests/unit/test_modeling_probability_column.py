"""逻辑回归的概率列：声明、取值、阈值，以及下游会不会串味。

⚠ 硬标签是**概率过一次阈值**的产物，两者必须在同一个数上翻面：各算一遍的话，
阈值附近的行会出现「概率 0.62、标签却是负类」这种自相矛盾且不报错的结果
（docs/MODELING_RESULT_VIEW_DESIGN.md §13）。
"""

import math
from typing import Any

import pytest
from pydantic import ValidationError

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    MetricsPayload,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.operators.frame import (
    COLUMN_ROLES,
    DTYPE_NUMBER,
    ROLE_FEATURE,
    ROLE_TARGET,
)
from platform_server.apps.modeling.operators.model import (
    SCORED_PRED,
    SCORED_PROBA,
    SCORED_TRUE,
)
from platform_server.apps.modeling.operators.payloads import ModelPayload
from platform_server.apps.modeling.operators.regression import (
    LogisticRegressionOperator,
)
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.entry_contract import NodeRecord
from platform_server.apps.modeling.services.publish_service import inspect_run
from platform_server.apps.modeling.services.run_executor import execute_graph
from platform_server.apps.modeling.services.serving import compile_model
from unit.modeling_fakes import DirectRunner, edge, execution_of, node

FEATURE = "温度"
TARGET = "报警"
TABLE = "alarm_h"
# 判正类的出厂阈值，也是存量已发布版本读不到这个键时的回落值
DEFAULT_THRESHOLD = 0.5
# 一个偏高的阈值：正好落在下面那份重叠数据的概率区间中段
STRICT_THRESHOLD = 0.7
# 温度过它就报警——图上那份取数数据的分界
ALARM_AT = 6
# 一小时一行，起点随便取一个 UTC 毫秒时刻
START_MS = 1_754_380_800_000
STEP_MS = 3_600_000
# 两类分得开的一小份数据：概率贴着 0 与 1
SEPARABLE = [
    (1.0, 0.0),
    (2.0, 0.0),
    (3.0, 0.0),
    (8.0, 1.0),
    (9.0, 1.0),
    (10.0, 1.0),
]
# 两类互相咬着的一份数据：概率铺满 0.14–0.86，挪阈值才看得出效果
OVERLAPPING = [
    (1.0, 0.0),
    (2.0, 0.0),
    (3.0, 1.0),
    (4.0, 0.0),
    (5.0, 1.0),
    (6.0, 0.0),
    (7.0, 1.0),
    (8.0, 1.0),
]
# 三行手写打分数据上的两个手算指标
HAND_ACCURACY = 2 / 3
HAND_MAE = 1 / 3


def _training(rows: list[tuple[float, float]]) -> Frame:
    """一列特征、一列两类目标的帧。

    Args: rows。
    """
    return Frame(
        columns=(
            FrameColumn(
                key=FEATURE, name=FEATURE, dtype="number", role=ROLE_FEATURE
            ),
            FrameColumn(
                key=TARGET, name=TARGET, dtype="number", role=ROLE_TARGET
            ),
        ),
        rows=tuple(rows),
    )


def _scored_of(
    rows: list[tuple[float, float]] = SEPARABLE, **config: Any
) -> Frame:
    """跑一遍逻辑回归，回它的打分帧。

    Args: rows, config。
    """
    operator, _ = registry.build("logistic_regression", config)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    frame = _training(rows)
    scored = operator.run({"train": frame, "test": frame})["scored"]
    assert isinstance(scored, Frame)
    return scored


def _floats(frame: Frame, key: str) -> list[float]:
    """一列的取值，当作数取出来。

    Args: frame, key。
    """
    return [float(value or 0.0) for value in frame.values_of(key)]


def test_the_scored_frame_carries_a_probability_column() -> None:
    """打分帧是三列：真实类目、预测类目、正类概率。"""
    assert _scored_of().keys == (SCORED_TRUE, SCORED_PRED, SCORED_PROBA)


def test_the_declaration_names_the_same_three_columns() -> None:
    """`describe_columns` 说的与真跑出来的是同一份列，且同序。

    ⚠ 声明写错不报错：它只让入口契约与下游列候选悄悄错一列。
    """
    config = LogisticRegressionOperator.CONFIG_MODEL.model_validate({})
    declared = LogisticRegressionOperator.describe_columns(
        config, {"train": (FEATURE, TARGET), "test": (FEATURE, TARGET)}
    )
    assert declared["scored"] == (SCORED_TRUE, SCORED_PRED, SCORED_PROBA)
    assert declared["scored"] == _scored_of().keys


def test_the_probability_column_is_shaped_like_the_other_two() -> None:
    """概率列的列定义与真实值 / 预测值那两列同款：数值、无单位、同一个角色。

    ⚠ 帧上合法的角色只有 feature / target / ignored 三个
    （`operators/frame.py` 的 `COLUMN_ROLES`）：自造一个第四种的话，
    `keys_by_role` 那一族会把这一列整个漏掉，而没有任何一处会报错。
    """
    scored = _scored_of()
    proba = scored.column_of(SCORED_PROBA)
    assert (proba.dtype, proba.unit) == (DTYPE_NUMBER, "")
    assert proba.role == scored.column_of(SCORED_PRED).role == ROLE_FEATURE
    assert proba.role in COLUMN_ROLES
    assert proba.name == "正类概率"


def test_the_probability_column_is_a_share_between_zero_and_one() -> None:
    """每一格都落在 [0, 1] 内，且正负两类的概率分处 0.5 两侧。"""
    values = _floats(_scored_of(), SCORED_PROBA)
    assert len(values) == len(SEPARABLE)
    assert all(0.0 <= value <= 1.0 for value in values)
    assert max(values[:3]) < DEFAULT_THRESHOLD
    assert min(values[3:]) > DEFAULT_THRESHOLD


def test_the_probability_is_the_sigmoid_of_the_fitted_line() -> None:
    """概率与拿系数手算的 sigmoid 逐行一致，不是别的什么数。"""
    operator, _ = registry.build("logistic_regression", {})
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    frame = _training(OVERLAPPING)
    scored = operator.run({"train": frame, "test": frame})["scored"]
    assert isinstance(scored, Frame)
    fitted = operator.dump_fitted() or {}
    slope = float(fitted["coef"][FEATURE])
    intercept = float(fitted["intercept"])
    assert _floats(scored, SCORED_PROBA) == pytest.approx(
        [
            1.0 / (1.0 + math.exp(-(intercept + slope * row[0])))
            for row in OVERLAPPING
        ]
    )


def test_a_row_sitting_exactly_on_the_threshold_counts_as_positive() -> None:
    """概率正好等于阈值的那一行算正类。

    ⚠ 「不小于」写成「大于」的话，恰好落在阈值上的行会被判成负类，而除了这
    一行以外一切照旧——用不贴边的数据永远试不出来。
    """
    edge = _floats(_scored_of(OVERLAPPING), SCORED_PROBA)[0]
    scored = _scored_of(OVERLAPPING, positive_threshold=edge)
    assert _floats(scored, SCORED_PROBA)[0] == edge
    assert _floats(scored, SCORED_PRED) == [1.0] * len(OVERLAPPING)


def test_the_hard_label_is_the_probability_read_at_the_threshold() -> None:
    """标签就是概率与阈值比出来的那一面，逐行核对。"""
    scored = _scored_of(OVERLAPPING)
    probabilities = _floats(scored, SCORED_PROBA)
    assert _floats(scored, SCORED_PRED) == [
        1.0 if value >= DEFAULT_THRESHOLD else 0.0 for value in probabilities
    ]
    assert sum(_floats(scored, SCORED_PRED)) == len(OVERLAPPING) / 2


def test_a_stricter_threshold_moves_the_labels_not_the_probabilities() -> None:
    """把阈值抬到 0.7：概率一格不变，中间那两行改判负类。"""
    loose = _scored_of(OVERLAPPING, positive_threshold=DEFAULT_THRESHOLD)
    strict = _scored_of(OVERLAPPING, positive_threshold=STRICT_THRESHOLD)
    probabilities = _floats(strict, SCORED_PROBA)
    assert probabilities == _floats(loose, SCORED_PROBA)
    assert _floats(strict, SCORED_PRED) == [
        1.0 if value >= STRICT_THRESHOLD else 0.0 for value in probabilities
    ]
    assert sum(_floats(loose, SCORED_PRED)) == 4.0
    assert sum(_floats(strict, SCORED_PRED)) == 2.0


def test_the_threshold_is_a_bounded_hyper_parameter() -> None:
    """阈值是超参，取值被夹在 [0, 1] 内，界外当场拒绝。"""
    schema = LogisticRegressionOperator.CONFIG_MODEL.model_json_schema()
    field = schema["properties"]["positive_threshold"]
    assert field["default"] == DEFAULT_THRESHOLD
    assert (field["minimum"], field["maximum"]) == (0.0, 1.0)
    assert field["title"] == "判正类的概率阈值"
    assert field["description"]
    with pytest.raises(ValidationError, match="positive_threshold"):
        registry.build("logistic_regression", {"positive_threshold": 1.5})


def test_the_threshold_reaches_whoever_rebuilds_the_model() -> None:
    """阈值进 `hyper_params`，重建出来的模型判得出同一批标签。

    ⚠ 特征重要性就是拿 `hyper_params` 重建模型再打分的：漏了这个键，重要性
    是在 0.5 上算的，而模型上线用的是另一个阈值。
    """
    operator, _ = registry.build(
        "logistic_regression", {"positive_threshold": STRICT_THRESHOLD}
    )
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    frame = _training(OVERLAPPING)
    payload = operator.run({"train": frame, "test": frame})["model"]
    assert isinstance(payload, ModelPayload)
    assert payload.hyper_params["positive_threshold"] == STRICT_THRESHOLD
    rebuilt, _ = registry.build(payload.algo, dict(payload.hyper_params))
    rebuilt.bind_runtime(tz_offset_minutes=0, split_plan=None)
    rebuilt.load_fitted(operator.dump_fitted() or {})
    assert rebuilt.predict_rows(frame) == operator.predict_rows(frame)
    assert sum(rebuilt.predict_rows(frame)) == 2.0


def test_a_third_class_yields_no_frame_at_all_let_alone_a_probability() -> None:
    """三个类目当场拒绝——多分类连打分帧都没有，更没有概率列。

    ⚠ ROC / PR / 校准曲线都要二分类的每行概率，这一条是它们的前提。
    """
    operator, _ = registry.build("logistic_regression", {})
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    frame = _training([(1.0, 0.0), (2.0, 1.0), (3.0, 2.0)])
    with pytest.raises(OperatorError, match="只做两类"):
        operator.run({"train": frame, "test": frame})


def _wide_scored() -> Frame:
    """一份手写的三列打分帧：真实、预测、概率。"""
    return Frame(
        columns=(
            FrameColumn(key=SCORED_TRUE, name="真实", dtype="number"),
            FrameColumn(key=SCORED_PRED, name="预测", dtype="number"),
            FrameColumn(key=SCORED_PROBA, name="正类概率", dtype="number"),
        ),
        rows=((1.0, 1.0, 0.91), (1.0, 0.0, 0.44), (0.0, 0.0, 0.12)),
    )


def _narrow_scored() -> Frame:
    """同一份数据去掉概率列。"""
    wide = _wide_scored()
    return Frame(
        columns=wide.columns[:2], rows=tuple(row[:2] for row in wide.rows)
    )


def _metrics_of(code: str, scored: Frame) -> MetricsPayload:
    """跑一个评估算子，回它的指标负载。

    Args: code, scored。
    """
    operator, _ = registry.build(code, {})
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    payload = operator.run({"scored": scored})["metrics"]
    assert isinstance(payload, MetricsPayload)
    return payload


@pytest.mark.parametrize(
    ("code", "metric", "hand"),
    [
        ("regression_metrics", "mae", HAND_MAE),
        ("classification_metrics", "accuracy", HAND_ACCURACY),
        ("residual_analysis", "residual_mean", HAND_MAE),
    ],
)
def test_the_downstream_evaluators_ignore_the_extra_column(
    code: str, metric: str, hand: float
) -> None:
    """多出来的那一列一个指标都不改，且指标与手算一致。

    ⚠ 按位置取列的话多一列就整帧错位，而错位不报错，只是数字变得莫名其妙：
    这三条钉的就是它们按列 key 取数（§13.5 R-38）。
    """
    wide = _metrics_of(code, _wide_scored())
    assert wide.metrics == _metrics_of(code, _narrow_scored()).metrics
    assert wide.metrics[metric] == pytest.approx(hand)


def _logit_frame(rows: int = 48) -> Frame:
    """一份两类可分的取数帧：温度过 6 就报警。

    Args: rows。
    """
    return Frame(
        columns=(
            FrameColumn(key=FEATURE, name=FEATURE, dtype="number", unit="℃"),
            FrameColumn(key=TARGET, name=TARGET, dtype="number"),
        ),
        rows=tuple(
            (float(index % 12), 1.0 if index % 12 > ALARM_AT else 0.0)
            for index in range(rows)
        ),
        index=tuple(START_MS + index * STEP_MS for index in range(rows)),
    )


def _logit_graph(**model_config: Any) -> PipelineGraph:
    """取数 → 填缺失 → 切分 → 逻辑回归 → 分类评估的最小闭环。

    Args: model_config。
    """
    return PipelineGraph(
        nodes=[
            node(
                "s",
                "ledger_source",
                table_code=TABLE,
                columns=[FEATURE, TARGET],
            ),
            node("f", "fill_missing"),
            node("p", "split_dataset", target_column=TARGET),
            node("m", "logistic_regression", **model_config),
            node("e", "classification_metrics"),
        ],
        edges=[
            edge("e1", "s", "frame", "f", "frame"),
            edge("e2", "f", "frame", "p", "frame"),
            edge("e3", "p", "train", "m", "train"),
            edge("e4", "p", "test", "m", "test"),
            edge("e5", "m", "scored", "e", "scored"),
        ],
    )


async def _records(
    **model_config: Any,
) -> tuple[PipelineGraph, dict[str, NodeRecord]]:
    """跑一遍闭环，回图与逐节点记录。

    Args: model_config。
    """
    graph = _logit_graph(**model_config)
    execution = execution_of(DirectRunner(), frames={"s": _logit_frame()})
    outcome = await execute_graph(graph, execution=execution)
    return graph, {
        item.node_id: NodeRecord(
            preview=dict(item.preview), fitted=item.fitted, io=dict(item.io)
        )
        for item in outcome.nodes
    }


def _logit_step(serving: dict[str, Any]) -> dict[str, Any]:
    """可服务表示里逻辑回归那一步。

    Args: serving。
    """
    steps: list[dict[str, Any]] = serving["steps"]
    found = [
        item for item in steps if item["operator"] == "logistic_regression"
    ]
    assert len(found) == 1
    return found[0]


def _with_model_config(
    serving: dict[str, Any], config: dict[str, Any]
) -> dict[str, Any]:
    """换掉逻辑回归那一步的参数，其余原样。

    Args: serving, config。
    """
    steps: list[dict[str, Any]] = serving["steps"]
    return {
        **serving,
        "steps": [
            (
                {**item, "config": config}
                if item["operator"] == "logistic_regression"
                else item
            )
            for item in steps
        ],
    }


async def test_the_run_records_the_three_columns_it_really_produced() -> None:
    """真跑一遍记下来的输出列，与声明推出来的那一份一致。"""
    _, records = await _records()
    assert tuple(records["m"].io["outputs"]["scored"]) == (
        SCORED_TRUE,
        SCORED_PRED,
        SCORED_PROBA,
    )


async def test_the_published_version_carries_the_threshold() -> None:
    """发布件里逻辑回归那一步的参数带着阈值。"""
    graph, records = await _records(positive_threshold=STRICT_THRESHOLD)
    verdict = inspect_run(graph, records)
    assert verdict.is_servable is True, verdict.reason
    assert (
        _logit_step(verdict.serving)["config"]["positive_threshold"]
        == STRICT_THRESHOLD
    )


async def test_a_version_from_before_the_threshold_falls_back_to_a_half() -> (
    None
):
    """存量版本的参数里没有这个键，推理侧回落 0.5，与今天的行为一字不差。

    ⚠ 不回填存量版本：模型版本不可变，历史版本按当初的口径继续算才是对的。
    """
    graph, records = await _records()
    serving = inspect_run(graph, records).serving
    stripped = _with_model_config(serving, {})
    explicit = _with_model_config(
        serving, {"positive_threshold": DEFAULT_THRESHOLD}
    )
    assert "positive_threshold" not in _logit_step(stripped)["config"]
    below = float(ALARM_AT) - 1.0
    above = float(ALARM_AT) + 2.0
    assert compile_model(stripped).predict([above]) == 1.0
    assert compile_model(stripped).predict([below]) == 0.0
    for value in (below, above):
        assert compile_model(stripped).predict([value]) == compile_model(
            explicit
        ).predict([value])


async def test_a_published_threshold_really_changes_what_serving_answers() -> (
    None
):
    """阈值不是摆设：同一行在 0.5 与 0.99 下判出来的类目不同。"""
    graph, records = await _records()
    serving = inspect_run(graph, records).serving
    row = [float(ALARM_AT) + 1.0]
    loose = compile_model(
        _with_model_config(serving, {"positive_threshold": DEFAULT_THRESHOLD})
    )
    strict = compile_model(
        _with_model_config(serving, {"positive_threshold": 0.99})
    )
    assert loose.predict(row) == 1.0
    assert strict.predict(row) == 0.0


def _importance_baseline(threshold: float) -> float:
    """拿逻辑回归的模型描述跑一遍特征重要性，回打乱前的基线准确率。

    Args: threshold。
    """
    operator, _ = registry.build(
        "logistic_regression", {"positive_threshold": threshold}
    )
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    frame = _training(OVERLAPPING)
    payload = operator.run({"train": frame, "test": frame})["model"]
    assert isinstance(payload, ModelPayload)
    probe, _ = registry.build("feature_importance", {})
    probe.bind_runtime(tz_offset_minutes=0, split_plan=None)
    probe.run({"model": payload, "test": frame})
    blocks = {block.zone: block for block in probe.report()}
    items: Any = blocks["stats"].payload["items"]
    return float(items[0]["value"])


def test_feature_importance_eats_the_test_frame_not_the_scored_one() -> None:
    """特征重要性拿的是测试集那一份，概率列进不了它；基线跟着阈值走。

    ⚠ 它是唯一一个**重建模型再打分**的下游：漏掉阈值这个超参的话，重要性是
    在 0.5 上算的，而模型上线用的是另一个阈值，两个数没有一处对得上。
    """
    assert _importance_baseline(DEFAULT_THRESHOLD) == pytest.approx(0.75)
    assert _importance_baseline(0.99) == pytest.approx(0.5)
