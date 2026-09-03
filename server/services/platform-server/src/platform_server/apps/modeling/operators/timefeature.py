"""时间特征：从每一行的时刻造出小时、星期、月份这类列。

⚠ 这是**第一个会增列的算子**。它把第二期那套东西全用上了：`describe_columns`
声明造哪几列、入口契约因此停在「造之前」、逐步的期望列从入口正推
（docs/MODELING_PLATFORM_DESIGN.md D2 / D4）。
⚠ 它也是第一个**推理时需要时刻**的算子：单行预测里没有时间索引，时刻必须由
调用方给（D19）。
"""

from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
)
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    CellValue,
    Frame,
    FrameColumn,
    frame_input,
)
from platform_server.apps.modeling.operators.registry import register_operator

# 造得出来的几档时间成分
type TimePart = Literal["hour", "dayofweek", "month", "dayofyear", "is_weekend"]
TIME_PARTS: tuple[str, ...] = (
    "hour",
    "dayofweek",
    "month",
    "dayofyear",
    "is_weekend",
)
# 造出来的列名前缀。⚠ 定死不给配：可配的话同一条流水线的两个时间特征节点能
# 造出同名列，而后一个会静默盖掉前一个
COLUMN_PREFIX = "ts_"
# 周六起算的星期序号（周一为 0）
_SATURDAY = 5
# 每档给人看的名字
_PART_LABELS: dict[str, str] = {
    "hour": "小时",
    "dayofweek": "星期",
    "month": "月份",
    "dayofyear": "年内第几天",
    "is_weekend": "是否周末",
}


class TimeFeatureConfig(OperatorConfig):
    """时间特征的参数。"""

    parts: list[TimePart] = Field(
        default_factory=lambda: ["hour"],
        min_length=1,
        title="造哪几档",
        description=(
            "hour=小时(0-23)；dayofweek=星期(周一0…周日6)；month=月份(1-12)；"
            "dayofyear=年内第几天(1-366)；is_weekend=是否周末(0/1)"
        ),
    )


@register_operator
class TimeFeature(OperatorBase):
    """按每一行的时刻造出几列时间特征。

    ⚠ 一律按**业务时区**算，不按 UTC：东八区的「上午 9 点」在 UTC 是凌晨 1 点，
    按 UTC 算出来的「小时」整体偏 8，而每个数看着都在 0-23 之间。
    """

    CODE = "time_feature"
    NAME = "时间特征"
    DESCRIPTION = "从每一行的时刻造出小时 / 星期 / 月份这类列"
    CATEGORY = "feature"
    ICON = "calendar"
    CONFIG_MODEL = TimeFeatureConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    # 推理时也要跑——训练造了这几列，线上不造就是列对不上
    SERVING_NEEDS_INDEX = True

    @property
    def _config(self) -> TimeFeatureConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, TimeFeatureConfig):  # pragma: no cover
            raise OperatorError("时间特征拿到了不匹配的参数")
        return self.config

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """原有的列全留着，后面接上造出来的那几列。

        ⚠ 这几列是**派生列**：入口契约停在造它们之前，调用方不必也不该提供它们
        （docs/MODELING_PLATFORM_DESIGN.md D4）。
        Args: config, inputs。
        """
        given = inputs.get("frame")
        if given is None or not isinstance(config, TimeFeatureConfig):
            return {"frame": None}
        return {"frame": (*given, *_made_keys(_deduped(list(config.parts))))}

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """按时刻造列。没有时刻就说清楚，不拿行号顶替。

        Args: inputs。
        """
        frame = frame_input(inputs, "frame")
        if frame.index is None:
            raise OperatorError(
                "这份数据没有时刻，造不出时间特征——推理时请在请求里带上时刻"
            )
        parts = _deduped(list(self._config.parts))
        _refuse_collisions(frame, parts)
        made = [
            _made_column(part, frame.index, self.tz_offset_minutes)
            for part in parts
        ]
        return {"frame": _appended(frame, parts, made)}


def _made_keys(parts: list[str]) -> tuple[str, ...]:
    """这几档会造出哪几个列 key。

    Args: parts。
    """
    return tuple(f"{COLUMN_PREFIX}{part}" for part in parts)


def _deduped(parts: list[str]) -> list[str]:
    """按原序去重。

    ⚠ 去重不是洁癖：同一档配两遍会造出两个同名列，而按 key 取值只取得到头一个，
    下游拿到的是哪一列全看运气。
    Args: parts。
    """
    seen: list[str] = []
    for part in parts:
        if part not in seen:
            seen.append(part)
    return seen


def _refuse_collisions(frame: Frame, parts: list[str]) -> None:
    """要造的列名已经被占了就当场说清楚。

    ⚠ 硬造下去会让帧上出现两个同名列，而按 key 取值只取得到头一个——下游拿到
    的是原来那一列，静默算错。
    Args: frame, parts。
    """
    taken = set(frame.keys) & set(_made_keys(parts))
    if taken:
        raise OperatorError(
            f"要造的列名已经有了：{'、'.join(sorted(taken))}。"
            "请先把上游那几列改名或去掉"
        )


def _made_column(
    part: str, index: tuple[int, ...], tz_offset_minutes: int
) -> list[CellValue]:
    """一档时间成分在每一行上的取值。

    Args: part, index, tz_offset_minutes。
    """
    return [
        _part_of(part, _local(moment, tz_offset_minutes)) for moment in index
    ]


def _local(moment: int, tz_offset_minutes: int) -> datetime:
    """把 UTC 毫秒折成业务时区的那个时刻。

    Args: moment, tz_offset_minutes。
    """
    return datetime.fromtimestamp(moment / 1000, UTC) + timedelta(
        minutes=tz_offset_minutes
    )


def _part_of(part: str, moment: datetime) -> float:
    """一个时刻上某一档的取值。

    Args: part, moment。
    """
    if part == "hour":
        return float(moment.hour)
    if part == "dayofweek":
        return float(moment.weekday())
    if part == "month":
        return float(moment.month)
    if part == "dayofyear":
        return float(moment.timetuple().tm_yday)
    return 1.0 if moment.weekday() >= _SATURDAY else 0.0


def _appended(
    frame: Frame, parts: list[str], made: list[list[CellValue]]
) -> Frame:
    """把造出来的几列接到帧的后面。

    Args: frame, parts, made。
    """
    columns = (
        *frame.columns,
        *(
            FrameColumn(
                key=f"{COLUMN_PREFIX}{part}",
                name=_PART_LABELS[part],
                dtype=DTYPE_NUMBER,
            )
            for part in parts
        ),
    )
    rows = tuple(
        (*row, *(column[position] for column in made))
        for position, row in enumerate(frame.rows)
    )
    return Frame(
        columns=columns,
        rows=rows,
        index=frame.index,
        index_name=frame.index_name,
        provenance=frame.provenance,
    )
