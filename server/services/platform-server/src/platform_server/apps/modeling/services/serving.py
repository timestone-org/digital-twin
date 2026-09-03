"""把一个模型版本的 `serving_json` 编译成一个纯计算的可调用对象。

⚠ 推理路径**零 I/O**：编译发生在取数相位（允许查库），编译出来的东西在求值期
只做算术（docs/MODELING_DESIGN.md D20）。
⚠ 每一步先断言 `expected_input_columns` 再执行：训练期与推理期列序不同而不
断言的话，错位的变换照样施加，结果是**无异常、无告警的错误预测**（§5.2）。
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from platform_server.apps.modeling.operators import (
    CHANNEL_BINARY,
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

# `serving_json` 的线形版本。发布写的是它，加载期据此分派
SERVING_FORMAT_VERSION = "2.0"
# 头一版：入口契约取 `input_columns`，且每一步的期望列都是同一份特征列。
# ⚠ 这条加载路径**一行都不许改**：模型版本不可变，历史版本必须按它当初的口径
# 继续算。改了不会报错，只是从某一天起某几列的历史值与新值口径不同
SERVING_FORMAT_V1 = "1.0"

_FIELD_VERSION = "format_version"
_FIELD_INPUTS = "input_columns"
_FIELD_ENTRY = "entry_columns"
_FIELD_KEY = "key"
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
        self,
        *,
        features: tuple[str, ...],
        steps: tuple[_Step, ...],
        estimator: object | None = None,
    ) -> None:
        self._features = features
        self._steps = steps
        self._estimator = estimator

    @property
    def needs_estimator(self) -> bool:
        """这条链上有没有哪一步的模型本体在二进制产物里（通道 B）。"""
        return any(
            registry.get(step.operator).SERVING_CHANNEL == CHANNEL_BINARY
            for step in self._steps
        )

    @property
    def requires_timestamp(self) -> bool:
        """这条链上有没有哪一步要这一行的时刻。"""
        return any(
            registry.get(step.operator).SERVING_NEEDS_INDEX
            for step in self._steps
        )

    @property
    def should_batch(self) -> bool:
        """整批算划不划算。通道 B 划算：逐行调等于逐行付一次到 C 的往返。

        ⚠ 通道 A 那些一行就是几个乘加，整批算省不出什么，反倒多跑一趟收集
        相位——所以这里要如实说「不划算」。
        """
        return self.needs_estimator

    def predict_many(
        self, rows: list[tuple[list[float | None], datetime | None]]
    ) -> list[float | None]:
        """整批算，结果按传入顺序回。

        ⚠ 实参里有空的那些行**不进批**：它们的答案恒为 None，而混进去会让
        缺失值参与拟合链上的变换，算出一个看着正常的数。
        Args: rows。
        """
        answers: list[float | None] = [None] * len(rows)
        live = [
            index
            for index, (args, at) in enumerate(rows)
            if self._is_answerable(args, at)
        ]
        if not live:
            return answers
        frame = _rows(
            self._features,
            [[float(item or 0.0) for item in rows[index][0]] for index in live],
            index=tuple(_epoch_ms(rows[index][1]) for index in live),
        )
        for step in self._steps:
            frame = _apply(step, frame, self._estimator)
        for slot, index in enumerate(live):
            answers[index] = _value_at(frame, slot)
        return answers

    def _is_answerable(
        self, args: list[float | None], at: datetime | None
    ) -> bool:
        """这一行进不进批。形状不对当场抛，缺值只是不进批。

        Args: args, at。
        """
        self._refuse_bad_shape(args, at)
        return all(item is not None for item in args)

    def _refuse_bad_shape(
        self, args: list[float | None], at: datetime | None
    ) -> None:
        """实参个数与时刻这两条硬要求。

        Args: args, at。
        """
        if len(args) != len(self._features):
            raise OperatorError(
                f"这个模型要 {len(self._features)} 个实参，"
                f"这里给了 {len(args)} 个"
            )
        if self.requires_timestamp and at is None:
            raise OperatorError(
                "这个模型带时间特征，预测时必须给出这一行的时刻"
            )

    def predict(
        self, args: list[float | None], at: datetime | None = None
    ) -> float | None:
        """按实参算一个数；实参个数对不上或算不出来时给 None。

        ⚠ `at` 是**这一行的时刻**，只有链上带时间特征时才用得上。要而没给时
        当场说清楚——拿「现在」顶替会让同一行在不同时候算出不同的数（D19）。
        Args: args, at。
        """
        self._refuse_bad_shape(args, at)
        if any(item is None for item in args):
            return None
        frame = _one_row(
            self._features,
            [float(item or 0.0) for item in args],
            at=at,
        )
        for step in self._steps:
            frame = _apply(step, frame, self._estimator)
        return _single_value(frame)


def compile_model(
    serving: dict[str, Any], *, estimator: object | None = None
) -> CompiledModel:
    """把 `serving_json` 编译成可调用对象。形状不对即抛。

    ⚠ 按 `format_version` 分派而不是嗅探键：两版的入口契约含义不同——1.0 那份
    是**特征工程之后**的列，2.0 那份是之前的（docs/MODELING_PLATFORM_DESIGN.md
    D4）。嗅探键会让一份缺字段的 2.0 悄悄走 1.0 的路。
    ⚠ `estimator` 是通道 B 的模型本体，由**取数相位**从对象存储加载好了再交
    进来：编译本身不许有 I/O，它跑在求值路径上（D20）。
    Args: serving, estimator。
    """
    features = _entry_keys_of(serving)
    if not features:
        raise OperatorError("这个模型版本没有输入契约")
    compiled = CompiledModel(
        features=features,
        steps=tuple(
            _step_of(item) for item in as_list(serving.get(_FIELD_STEPS))
        ),
        estimator=estimator,
    )
    if compiled.needs_estimator and estimator is None:
        raise OperatorError("这个模型的本体存在二进制产物里，还没有加载进来")
    return compiled


def _entry_keys_of(serving: dict[str, Any]) -> tuple[str, ...]:
    """调用方要提供的那几列，按序。

    Args: serving。
    """
    version = as_text(serving.get(_FIELD_VERSION))
    if version == SERVING_FORMAT_V1:
        return tuple(as_texts(serving.get(_FIELD_INPUTS)))
    if version == SERVING_FORMAT_VERSION:
        return tuple(
            as_text(as_dict(item).get(_FIELD_KEY))
            for item in as_list(serving.get(_FIELD_ENTRY))
        )
    raise OperatorError("这个模型版本的可服务表示读不懂")


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


def _apply(step: _Step, frame: Frame, estimator: object | None) -> Frame:
    """跑一步。列集与训练时对不上就**显式失败**，不硬算。

    ⚠ 产模型的那一步走 `predict_rows` 而不是 `run`：`run` 是训练路径，它会拿
    这一行重新拟合一次，算出来的东西与线上模型毫无关系——而且不会报任何错。
    ⚠ 通道 B 那一步的拟合结果**不在** `fitted` 里：`fitted` 只有一份列序，
    模型本体要靠 `attach_estimator` 装上。漏装的表现不是报错，是那一步说自己
    「还没有拟合结果」——所以编译期就先拦一道。
    Args: step, frame, estimator。
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
    channel = registry.get(step.operator).SERVING_CHANNEL
    if channel == CHANNEL_BINARY and estimator is not None:
        operator.attach_estimator(estimator)
    if channel:
        return _rows(
            (_PREDICTION_KEY,),
            [[value] for value in operator.predict_rows(frame)],
        )
    produced = operator.run({"frame": frame}).get("frame")
    if not isinstance(produced, Frame):
        raise OperatorError(f"步骤「{step.operator}」在推理时没有产出数据")
    return produced


def _one_row(
    keys: tuple[str, ...], values: list[float], at: datetime | None = None
) -> Frame:
    """推理时的那一行。带上时刻，时间特征才造得出列。

    Args: keys, values, at。
    """
    return _rows(keys, [values], index=None if at is None else (_epoch_ms(at),))


def _rows(
    keys: tuple[str, ...],
    values: list[list[float]],
    index: tuple[int, ...] | None = None,
) -> Frame:
    """推理时的那几行。

    ⚠ 整批与单行走**同一个**构造：两份构造分开写之后，谁改了列的 dtype 谁就
    只改了一半，而两条路算出来的数会从某一天起对不上。
    Args: keys, values, index。
    """
    return Frame(
        columns=tuple(
            FrameColumn(key=key, name=key, dtype="number") for key in keys
        ),
        rows=tuple(tuple(row) for row in values),
        index=index,
    )


def _epoch_ms(at: datetime | None) -> int:
    """这一行的时刻，毫秒。没有时刻的那些行用 0 占位。

    ⚠ 占位只对**不带时间特征**的链成立：带时间特征而没有时刻的行早在
    `_refuse_bad_shape` 就被拒了，走不到这里。
    Args: at。
    """
    return 0 if at is None else int(at.timestamp() * 1000)


def _value_at(frame: Frame, position: int) -> float | None:
    """整批结果里的第 n 个数。

    Args: frame, position。
    """
    if position >= frame.row_count or not frame.columns:
        raise OperatorError("模型没有算出这一行的数")
    value = frame.rows[position][-1]
    if value is None:
        return None
    if isinstance(value, str):
        raise OperatorError("模型算出来的不是一个数")
    return float(value)


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
