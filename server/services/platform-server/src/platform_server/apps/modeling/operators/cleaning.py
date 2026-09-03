"""不带拟合的清洗算子：类型归一、丢缺失、条件过滤、时间重采样。

分类都是 `preprocess`，与 `preprocess.py` 的区别只有一条：**这几个不学参数**。
按这条线分模块，是因为带拟合的那些各自都拖着 dump / load / validate 三件套，
混在一个文件里很快就顶到模块行数上限。
"""

from collections.abc import Callable
from dataclasses import replace
from typing import Any, Literal

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
    column_field,
)
from platform_server.apps.modeling.operators.frame import (
    DTYPE_BOOLEAN,
    DTYPE_NUMBER,
    DTYPE_STRING,
    CellValue,
    Frame,
    FrameColumn,
    frame_input,
    null_ratio_of,
    numbers_of,
    select_rows,
    with_column_cast,
    without_columns,
)
from platform_server.apps.modeling.operators.registry import register_operator

type CastTarget = Literal["number", "bool", "string"]
# 转不动时的处置。⚠ coerce 那一档把转不动的格子变成空值，它的下游通常要接一个
# 填缺失——不然 `matrix_of` 会在那一行上抛
type CastErrorAction = Literal["coerce", "error"]

_DTYPE_OF: dict[str, str] = {
    "number": DTYPE_NUMBER,
    "bool": DTYPE_BOOLEAN,
    "string": DTYPE_STRING,
}
# 认得出的真假文本，全小写比对
_TRUTHY: dict[str, bool] = {
    "true": True,
    "false": False,
    "1": True,
    "0": False,
    "yes": True,
    "no": False,
}


class CastTypeConfig(OperatorConfig):
    """类型归一的参数。"""

    columns: list[str] = column_field(
        title="处理哪些列",
        description="留空表示一列都不动",
        default_factory=list[str],
    )
    to: CastTarget = Field(
        default="number",
        title="转成什么",
        description="number=数值；bool=真假；string=文本",
    )
    on_error: CastErrorAction = Field(
        default="coerce",
        title="转不动时",
        description="coerce=当成空值放过；error=当场报错",
    )


@register_operator
class CastType(OperatorBase):
    """把几列的类型统一成一种。"""

    CODE = "cast_type"
    NAME = "类型归一"
    DESCRIPTION = "把指定的几列统一转成数值 / 真假 / 文本"
    CATEGORY = "preprocess"
    ICON = "type"
    CONFIG_MODEL = CastTypeConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)

    @property
    def _config(self) -> CastTypeConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, CastTypeConfig):  # pragma: no cover
            raise OperatorError("类型归一拿到了不匹配的参数")
        return self.config

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """逐列转类型，**列定义上的类型跟着改**。

        ⚠ 只换值不改列定义的话，下游 `numbers_of` 仍按旧类型判，一列刚转好的
        数值会被当成文本拒掉。
        Args: inputs。
        """
        config = self._config
        frame = frame_input(inputs, "frame")
        for key in config.columns:
            values = [
                _cast_one(value, config.to, config.on_error, key)
                for value in frame.values_of(key)
            ]
            frame = with_column_cast(frame, key, values, _DTYPE_OF[config.to])
        return {"frame": frame}


type DropAxis = Literal["row", "col"]
type DropHow = Literal["any", "all"]


class DropMissingConfig(OperatorConfig):
    """丢缺失的参数。⚠ `how` 只管丢行，`max_null_ratio` 只管丢列。"""

    axis: DropAxis = Field(
        default="row",
        title="丢什么",
        description="row=丢有缺失的行；col=丢空得太多的列",
    )
    how: DropHow = Field(
        default="any",
        title="丢行的判据",
        description="any=有一个空就丢这行；all=这几列全空才丢",
    )
    subset: list[str] = column_field(
        title="只看这几列",
        description="留空表示看全部列",
        default_factory=list[str],
    )
    max_null_ratio: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        title="丢列的空值率上限",
        description="空值率超过它的列会被丢掉；丢行那一档用不上",
    )


@register_operator
class DropMissing(OperatorBase):
    """把缺失太多的行或列去掉。"""

    CODE = "drop_missing"
    NAME = "丢缺失"
    DESCRIPTION = "丢掉有缺失的行，或丢掉空值率过高的列"
    CATEGORY = "preprocess"
    ICON = "trash"
    CONFIG_MODEL = DropMissingConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    # ⚠ 丢列那一档不改行数，但类变量是静态的、看不见参数：往严了声明。代价是
    # 它插不进「带拟合的算子 → 切分」之间，而那个位置本来也不该丢缺失
    CHANGES_ROW_COUNT = True
    # 推理时只有一行：丢行等于把这次预测丢掉，丢列等于按一行的空值率判——都不对
    ENABLED_IN_SERVING = False

    @property
    def _config(self) -> DropMissingConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, DropMissingConfig):  # pragma: no cover
            raise OperatorError("丢缺失拿到了不匹配的参数")
        return self.config

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """丢行不改列集；丢列**静态推不出来**——丢谁取决于数据，不取决于参数。

        Args: config, inputs。
        """
        if isinstance(config, DropMissingConfig) and config.axis == "col":
            return {"frame": None}
        return {"frame": inputs.get("frame")}

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """按参数丢行或丢列。丢光了就报错，不交一份空帧下去。

        Args: inputs。
        """
        frame = frame_input(inputs, "frame")
        if self._config.axis == "col":
            return {"frame": self._without_empty_columns(frame)}
        return {"frame": self._without_holed_rows(frame)}

    def _without_empty_columns(self, frame: Frame) -> Frame:
        limit = self._config.max_null_ratio
        dropped = tuple(
            column.key
            for column in frame.columns
            if null_ratio_of(frame, column.key) > limit
        )
        kept = without_columns(frame, dropped)
        if not kept.columns:
            raise OperatorError(f"每一列的空值率都超过了 {limit}，一列都没剩")
        return kept

    def _without_holed_rows(self, frame: Frame) -> Frame:
        keys = self._config.subset or list(frame.keys)
        positions = [frame.position_of(key) for key in keys]
        kept = [
            index
            for index, row in enumerate(frame.rows)
            if not _is_holed(row, positions, self._config.how)
        ]
        if not kept:
            raise OperatorError("按这个判据每一行都被丢掉了，没有数据能往下走")
        return select_rows(frame, kept)


# 闭合的比较运算。⚠ 这里**不许**变成一段表达式：那是一个任意代码执行面
# （docs/MODELING_DESIGN.md §9.3 防线②）
type CompareOp = Literal[
    "eq", "ne", "gt", "gte", "lt", "lte", "is_blank", "not_blank"
]
# 不看比较值的那两档
_BLANK_OPS = ("is_blank", "not_blank")


class FilterRowsConfig(OperatorConfig):
    """条件过滤的参数：一列 + 一个运算 + 一个值，三样都是闭合的。"""

    column: str = column_field(title="按哪一列", description="拿这一列去比")
    op: CompareOp = Field(
        default="gte",
        title="怎么比",
        description=(
            "eq=等于；ne=不等于；gt=大于；gte=大于等于；lt=小于；"
            "lte=小于等于；is_blank=是空值；not_blank=不是空值"
        ),
    )
    value: float = Field(
        default=0.0,
        title="比较值",
        description="is_blank / not_blank 两档用不上",
    )


@register_operator
class FilterRows(OperatorBase):
    """只留下符合条件的行。"""

    CODE = "filter_rows"
    NAME = "条件过滤"
    DESCRIPTION = "按一列的取值筛掉不要的行"
    CATEGORY = "preprocess"
    ICON = "list-checks"
    CONFIG_MODEL = FilterRowsConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    CHANGES_ROW_COUNT = True
    # 推理时只有一行，筛掉它等于这次预测算不出数
    ENABLED_IN_SERVING = False

    @property
    def _config(self) -> FilterRowsConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, FilterRowsConfig):  # pragma: no cover
            raise OperatorError("条件过滤拿到了不匹配的参数")
        return self.config

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """筛行。一行都不剩就报错，不交一份空帧下去。

        Args: inputs。
        """
        config = self._config
        frame = frame_input(inputs, "frame")
        values = (
            frame.values_of(config.column)
            if config.op in _BLANK_OPS
            else numbers_of(frame, config.column)
        )
        kept = [
            index
            for index, value in enumerate(values)
            if _keeps(value, config.op, config.value)
        ]
        if not kept:
            raise OperatorError(
                f"按这个条件筛下来一行都不剩，请放宽「{config.column}」那一条"
            )
        return {"frame": select_rows(frame, kept)}


def _cast_one(
    value: CellValue, target: CastTarget, on_error: CastErrorAction, key: str
) -> CellValue:
    """把一个格子转成目标类型。转不动时按参数放过或报错。

    Args: value, target, on_error, key。
    """
    if value is None:
        return None
    converted = _converted(value, target)
    if converted is None and on_error == "error":
        raise OperatorError(f"列「{key}」里的「{value}」转不成{target}")
    return converted


def _converted(value: CellValue, target: CastTarget) -> CellValue:
    """转得动就给结果，转不动给 `None`。

    Args: value, target。
    """
    if target == "string":
        return str(value)
    if target == "bool":
        return _as_bool(value)
    return _as_float(value)


def _as_bool(value: CellValue) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int | float)):
        return value != 0
    return _TRUTHY.get(str(value).strip().lower())


def _as_float(value: CellValue) -> float | None:
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int | float)):
        return float(value)
    try:
        return float(str(value))
    except ValueError:
        return None


def _is_holed(
    row: tuple[CellValue, ...], positions: list[int], how: DropHow
) -> bool:
    """这一行按判据算不算「缺失」。

    Args: row, positions, how。
    """
    blanks = [row[position] is None for position in positions]
    return all(blanks) if how == "all" else any(blanks)


def _keeps(value: CellValue, op: CompareOp, threshold: float) -> bool:
    """这一行留不留。

    ⚠ 空值在比较那几档里一律**不留**：拿它当 0 去比会静默把「没测到」当成一个
    真实取值，而那正是台账那边一路守着不许 coalesce 的东西。
    Args: value, op, threshold。
    """
    if op == "is_blank":
        return value is None
    if op == "not_blank":
        return value is not None
    if value is None or isinstance(value, str):
        return False
    return _compare(float(value), op, threshold)


def _compare(value: float, op: CompareOp, threshold: float) -> bool:
    """六档数值比较。

    Args: value, op, threshold。
    """
    if op == "eq":
        return value == threshold
    if op == "ne":
        return value != threshold
    if op == "gt":
        return value > threshold
    if op == "gte":
        return value >= threshold
    if op == "lt":
        return value < threshold
    return value <= threshold


# 时间桶的宽度，毫秒。⚠ 只给闭合的几档，不收「随便一个毫秒数」：那会让用户配出
# 与台账对不上的桶宽，而两边各自看着都对
_BUCKET_MS: dict[str, int] = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "6h": 21_600_000,
    "1d": 86_400_000,
}
type BucketWidth = Literal["1m", "5m", "15m", "1h", "6h", "1d"]

# 聚合口径。⚠ **与台账那八档同集合**，由契约用例钉住：两边漂了的表现是
# 「台账里按小时看是一个数、建模里按小时取是另一个数」
type AggFunc = Literal[
    "avg", "count", "delta", "first", "last", "max", "min", "sum"
]
AGG_FUNCS: tuple[str, ...] = (
    "avg",
    "count",
    "delta",
    "first",
    "last",
    "max",
    "min",
    "sum",
)

# 一分钟的毫秒数，把时区偏移折成毫秒用
_MINUTE_MS = 60_000


class ResampleConfig(OperatorConfig):
    """时间重采样的参数。"""

    bucket: BucketWidth = Field(
        default="1h",
        title="桶宽",
        description="1m=一分钟；5m=五分钟；15m=十五分钟；1h=一小时；"
        "6h=六小时；1d=一天",
    )
    agg: AggFunc = Field(
        default="avg",
        title="怎么聚",
        description=(
            "avg=平均；count=非空个数；delta=末值减初值；first=桶内第一个；"
            "last=桶内最后一个；max=最大；min=最小；sum=求和"
        ),
    )


@register_operator
class Resample(OperatorBase):
    """把行按时间桶合并。

    ⚠ 桶按**业务时区**对齐，不按 UTC：按 UTC 切「一天」在东八区会整体偏 8 小时，
    而算出来的数看着完全正常。
    ⚠ 空桶不补行：一段没有数据的时间就是没有数据，凭空造一行会把「没测到」变成
    一个真实取值。
    ⚠ 非数值列一律取桶内**最后一个**取值——平均 / 求和这些对文本没有意义。
    """

    CODE = "resample"
    NAME = "时间重采样"
    DESCRIPTION = "把行按时间桶合并成更粗的粒度"
    CATEGORY = "preprocess"
    ICON = "calendar"
    CONFIG_MODEL = ResampleConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    CHANGES_ROW_COUNT = True
    # 推理时只有一行，没有可合并的桶
    ENABLED_IN_SERVING = False

    @property
    def _config(self) -> ResampleConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, ResampleConfig):  # pragma: no cover
            raise OperatorError("时间重采样拿到了不匹配的参数")
        return self.config

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """按桶合并。没有时间索引就说清楚，不按行号硬分。

        Args: inputs。
        """
        frame = frame_input(inputs, "frame")
        if frame.index is None:
            raise OperatorError(
                "这份数据没有时间索引，重采样无从下手——"
                "请把取数那一步的行来源改成带时刻的那一档"
            )
        buckets = _buckets_of(
            frame.index, self._config.bucket, self.tz_offset_minutes
        )
        return {"frame": _merged(frame, buckets, self._config.agg)}


def _buckets_of(
    index: tuple[int, ...], bucket: BucketWidth, tz_offset_minutes: int
) -> list[tuple[int, list[int]]]:
    """`[(桶起点, 落在这个桶里的行下标)]`，按桶起点升序。

    ⚠ 先加时区偏移再取整、再减回去：直接对 UTC 毫秒取整，「一天」的边界会落在
    当地时间早上八点上。
    Args: index, bucket, tz_offset_minutes。
    """
    width = _BUCKET_MS[bucket]
    offset = tz_offset_minutes * _MINUTE_MS
    grouped: dict[int, list[int]] = {}
    for position, moment in enumerate(index):
        start = ((moment + offset) // width) * width - offset
        grouped.setdefault(start, []).append(position)
    return sorted(grouped.items())


def _merged(
    frame: Frame, buckets: list[tuple[int, list[int]]], agg: AggFunc
) -> Frame:
    """把每个桶折成一行。

    Args: frame, buckets, agg。
    """
    rows = tuple(
        tuple(
            _aggregated(frame, column, positions, agg)
            for column in frame.columns
        )
        for _, positions in buckets
    )
    return replace(frame, rows=rows, index=tuple(start for start, _ in buckets))


def _aggregated(
    frame: Frame,
    column: FrameColumn,
    positions: list[int],
    agg: AggFunc,
) -> CellValue:
    """一个桶里的一列折成一个值。

    Args: frame, column, positions, agg。
    """
    values = [
        frame.rows[position][frame.position_of(column.key)]
        for position in positions
    ]
    if column.dtype != DTYPE_NUMBER:
        return _last_present(values)
    numbers = [
        float(value)
        for value in values
        if isinstance(value, (int | float)) and not isinstance(value, bool)
    ]
    if agg == "count":
        return float(len(numbers))
    if not numbers:
        return None
    return _folded(numbers, agg)


# 八档聚合各自怎么折。⚠ 写成一张表而不是一串 if：加一档时只多一行，
# 而漏掉哪一档在登记那一刻就由「表的键 = 取值集合」那条用例逮到
_FOLDERS: dict[str, Callable[[list[float]], float]] = {
    "avg": lambda values: sum(values) / len(values),
    "sum": sum,
    "min": min,
    "max": max,
    "first": lambda values: values[0],
    "last": lambda values: values[-1],
    "delta": lambda values: values[-1] - values[0],
}


def _folded(numbers: list[float], agg: AggFunc) -> float:
    """一桶数值按口径折成一个数。

    Args: numbers, agg。
    """
    return _FOLDERS[agg](numbers)


def _last_present(values: list[CellValue]) -> CellValue:
    """桶内最后一个非空取值；全空就是空。

    Args: values。
    """
    for value in reversed(values):
        if value is not None:
            return value
    return None
