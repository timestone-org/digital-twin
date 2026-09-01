"""把一个模型版本的 `serving_json` 编译成一个纯计算的可调用对象。

⚠ 推理路径**零 I/O**：编译发生在取数相位（允许查库），编译出来的东西在求值期
只做算术（docs/MODELING_DESIGN.md D20）。
⚠ 每一步先断言 `expected_input_columns` 再执行：训练期与推理期列序不同而不
断言的话，错位的变换照样施加，结果是**无异常、无告警的错误预测**（§5.2）。
"""

from dataclasses import dataclass
from typing import Any

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.services.jsonshape import (
    as_dict,
    as_list,
    as_text,
    as_texts,
)

# `serving_json` 的线形版本。改形状要升它，加载期据此拒掉读不懂的版本
SERVING_FORMAT_VERSION = "1.0"

_FIELD_VERSION = "format_version"
_FIELD_INPUTS = "input_columns"
_FIELD_STEPS = "steps"
_FIELD_OPERATOR = "operator"
_FIELD_CONFIG = "config"
_FIELD_FITTED = "fitted"
_FIELD_EXPECTED = "expected_input_columns"
# 建模那一步产出的那一列的名字，只在编译出来的链路内部用
_PREDICTION_KEY = "__prediction__"


@dataclass(frozen=True)
class _Step:
    """可服务表示里的一步。"""

    operator: str
    config: dict[str, Any]
    fitted: dict[str, Any]
    expected: tuple[str, ...]


class CompiledModel:
    """一个编译好的模型：按位置吃实参，算一个数。

    ⚠ 实参按**绑定记下的顺序**落到特征列上，不按名字：调用点写的是台账列名、
    形参名是公式条目上的标签、特征名是训练时的列 key，三者可以完全不同，
    位置是唯一在三者之间稳定的东西（§7.4）。
    """

    def __init__(
        self, *, features: tuple[str, ...], steps: tuple[_Step, ...]
    ) -> None:
        self._features = features
        self._steps = steps

    def predict(self, args: list[float | None]) -> float | None:
        """按实参算一个数；实参个数对不上或算不出来时给 None。

        Args: args。
        """
        if len(args) != len(self._features):
            raise OperatorError(
                f"这个模型要 {len(self._features)} 个实参，"
                f"这里给了 {len(args)} 个"
            )
        if any(item is None for item in args):
            return None
        frame = _one_row(self._features, [float(item or 0.0) for item in args])
        for step in self._steps:
            frame = _apply(step, frame)
        return _single_value(frame)


def compile_model(serving: dict[str, Any]) -> CompiledModel:
    """把 `serving_json` 编译成可调用对象。形状不对即抛。

    Args: serving。
    """
    if serving.get(_FIELD_VERSION) != SERVING_FORMAT_VERSION:
        raise OperatorError("这个模型版本的可服务表示读不懂")
    features = tuple(as_texts(serving.get(_FIELD_INPUTS)))
    if not features:
        raise OperatorError("这个模型版本没有输入契约")
    return CompiledModel(
        features=features,
        steps=tuple(
            _step_of(item) for item in as_list(serving.get(_FIELD_STEPS))
        ),
    )


def _step_of(raw: Any) -> _Step:
    """把落库的一步还原成结构。

    Args: raw。
    """
    step = as_dict(raw)
    if not step:
        raise OperatorError("模型版本里有一步的形状不对")
    return _Step(
        operator=as_text(step.get(_FIELD_OPERATOR)),
        config=as_dict(step.get(_FIELD_CONFIG)),
        fitted=as_dict(step.get(_FIELD_FITTED)),
        expected=tuple(as_texts(step.get(_FIELD_EXPECTED))),
    )


def _apply(step: _Step, frame: Frame) -> Frame:
    """跑一步。列集与训练时对不上就**显式失败**，不硬算。

    ⚠ 产模型的那一步走 `predict_rows` 而不是 `run`：`run` 是训练路径，它会拿
    这一行重新拟合一次，算出来的东西与线上模型毫无关系——而且不会报任何错。
    Args: step, frame。
    """
    if step.expected and frame.keys != step.expected:
        raise OperatorError(
            "推理时的列与训练时不一致，拒绝继续——"
            f"训练时是 {list(step.expected)}，这次是 {list(frame.keys)}"
        )
    operator, _ = registry.build(step.operator, step.config)
    if step.fitted:
        operator.load_fitted(step.fitted)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    if registry.get(step.operator).SERVING_CHANNEL:
        return _one_row(
            (_PREDICTION_KEY,), [float(operator.predict_rows(frame)[0])]
        )
    produced = operator.run({"frame": frame}).get("frame")
    if not isinstance(produced, Frame):
        raise OperatorError(f"步骤「{step.operator}」在推理时没有产出数据")
    return produced


def _one_row(keys: tuple[str, ...], values: list[float]) -> Frame:
    return Frame(
        columns=tuple(
            FrameColumn(key=key, name=key, dtype="number") for key in keys
        ),
        rows=(tuple(values),),
    )


def _single_value(frame: Frame) -> float | None:
    """整条链路的最后一格。

    Args: frame。
    """
    if frame.row_count != 1 or not frame.columns:
        raise OperatorError("模型没有算出一个数")
    value = frame.rows[0][-1]
    if value is None:
        return None
    if isinstance(value, str):
        raise OperatorError("模型算出来的不是一个数")
    return float(value)
