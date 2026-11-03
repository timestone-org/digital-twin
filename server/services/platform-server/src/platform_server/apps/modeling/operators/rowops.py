"""去重、稳定排序和可复现抽样。"""

import math
from collections import Counter
from typing import Literal

import numpy as np
from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    OperatorConfig,
    column_field,
)
from platform_server.apps.modeling.operators.frame import (
    CellValue,
    Frame,
    frame_input,
    select_rows,
)
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.tabular import (
    FrameOperator,
    selected_keys,
)


class DeduplicateConfig(OperatorConfig):
    """重复行判据与保留方式。"""

    columns: list[str] = column_field(
        title="按哪些列判重",
        description="留空按全部列；空值与空值视为相同",
        default_factory=list[str],
    )
    keep: Literal["first", "last", "none"] = Field(
        default="first",
        title="重复项保留方式",
        description="first=保留第一行；last=保留最后一行；none=删除所有重复项",
    )


@register_operator
class Deduplicate(FrameOperator):
    CODE = "deduplicate"
    NAME = "重复行去重"
    DESCRIPTION = "按选定列识别重复项，保留原有行序和对应时刻"
    CATEGORY = "preprocess"
    ICON = "list-checks"
    CONFIG_MODEL = DeduplicateConfig
    CHANGES_ROW_COUNT = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        frame = frame_input(inputs, "frame")
        config = DeduplicateConfig.model_validate(self.config.model_dump())
        positions = [
            frame.position_of(key)
            for key in selected_keys(frame, config.columns)
        ]
        signatures = [
            tuple(row[position] for position in positions) for row in frame.rows
        ]
        if config.keep == "none":
            counts = Counter(signatures)
            chosen = [
                seat
                for seat, signature in enumerate(signatures)
                if counts[signature] == 1
            ]
        else:
            order = (
                range(frame.row_count)
                if config.keep == "first"
                else range(frame.row_count - 1, -1, -1)
            )
            seen: set[tuple[CellValue, ...]] = set()
            chosen: list[int] = []
            for seat in order:
                if signatures[seat] not in seen:
                    chosen.append(seat)
                    seen.add(signatures[seat])
            chosen.sort()
        return select_rows(frame, chosen)


class SortRowsConfig(OperatorConfig):
    """多列稳定排序参数。"""

    columns: list[str] = Field(
        title="排序列（按优先顺序）",
        description="留空按全部列排序；同值保持原行序",
        default_factory=list[str],
        json_schema_extra={"x-dt-widget": "column", "x-dt-ordered": True},
    )
    direction: Literal["ascending", "descending"] = Field(
        default="ascending",
        title="排序方向",
        description="ascending=升序；descending=降序",
    )
    nulls: Literal["first", "last"] = Field(
        default="last",
        title="空值位置",
        description="first=放在最前；last=放在最后",
    )


@register_operator
class SortRows(FrameOperator):
    CODE = "sort_rows"
    NAME = "多列排序"
    DESCRIPTION = "按列优先级稳定排序，时间索引随行移动；排序后再配置拟合步骤"
    CATEGORY = "preprocess"
    ICON = "list-checks"
    CONFIG_MODEL = SortRowsConfig
    # ⚠ 重排行同样使上游拟合使用的切分位置失效。
    CHANGES_ROW_COUNT = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        frame = frame_input(inputs, "frame")
        config = SortRowsConfig.model_validate(self.config.model_dump())
        keys = selected_keys(frame, config.columns)
        seats = list(range(frame.row_count))
        for key in reversed(keys):
            position = frame.position_of(key)
            present = [
                seat for seat in seats if frame.rows[seat][position] is not None
            ]
            missing = [
                seat for seat in seats if frame.rows[seat][position] is None
            ]
            present.sort(
                key=lambda seat: _sort_value(frame.rows[seat][position]),
                reverse=config.direction == "descending",
            )
            seats = (
                missing + present
                if config.nulls == "first"
                else present + missing
            )
        return select_rows(frame, seats)


def _sort_value(value: CellValue) -> tuple[int, float | str]:
    if isinstance(value, str):
        return (1, value)
    return (0, float(value) if value is not None else 0.0)


class SampleRowsConfig(OperatorConfig):
    """保留原序的有界抽样参数。"""

    method: Literal["random", "head", "stride"] = Field(
        default="random",
        title="抽样方式",
        description="random=随机抽样；head=取前若干行；stride=等距抽样",
    )
    size_mode: Literal["ratio", "count"] = Field(
        default="ratio",
        title="抽样数量口径",
        description="ratio=按比例；count=按固定行数",
    )
    ratio: float = Field(
        default=0.1,
        gt=0,
        le=1,
        title="保留比例",
        description="0.1 表示保留约 10%，非空输入至少保留一行",
        json_schema_extra={"x-dt-visible-when": {"size_mode": ["ratio"]}},
    )
    count: int = Field(
        default=1000,
        ge=1,
        le=200_000,
        title="保留行数",
        description="超过输入行数时保留全部",
        json_schema_extra={"x-dt-visible-when": {"size_mode": ["count"]}},
    )
    random_state: int = Field(
        default=42,
        ge=0,
        le=2**32 - 1,
        title="随机种子",
        description="相同输入和种子得到相同抽样结果",
        json_schema_extra={"x-dt-visible-when": {"method": ["random"]}},
    )


@register_operator
class SampleRows(FrameOperator):
    CODE = "sample_rows"
    NAME = "数据抽样"
    DESCRIPTION = "按比例或行数抽样，不重复抽取并保持原始时间顺序"
    CATEGORY = "preprocess"
    ICON = "list-checks"
    CONFIG_MODEL = SampleRowsConfig
    CHANGES_ROW_COUNT = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        frame = frame_input(inputs, "frame")
        config = SampleRowsConfig.model_validate(self.config.model_dump())
        desired = (
            config.count
            if config.size_mode == "count"
            else math.ceil(frame.row_count * config.ratio)
        )
        count = min(desired, frame.row_count)
        if config.method == "random":
            seats = sorted(
                int(seat)
                for seat in np.random.default_rng(config.random_state).choice(
                    frame.row_count, size=count, replace=False
                )
            )
        elif config.method == "stride":
            seats = [seat * frame.row_count // count for seat in range(count)]
        else:
            seats = list(range(count))
        return select_rows(frame, seats)
