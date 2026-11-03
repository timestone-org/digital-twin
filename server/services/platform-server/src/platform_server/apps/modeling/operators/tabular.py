"""通用表格算子的帧校验、变换记录与有界输出。"""

import math
from collections.abc import Sequence
from dataclasses import replace

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    OperatorBase,
    OperatorError,
    PortSpec,
)
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    ROLE_TARGET,
    CellValue,
    Frame,
    FrameColumn,
    Provenance,
)
from platform_server.apps.modeling.operators.reporting import (
    BlockAt,
    ColumnChange,
    ReportBlock,
    RowCounts,
    columns_block,
    rows_block,
)

MAX_ROWS = 200_000
MAX_COLUMNS = 256
MAX_TEXT = 4096
MAX_COLUMN_KEY = 256
FRAME_PORT = PortSpec(name="frame", contract=CONTRACT_FRAME, label="数据")


class FrameOperator(OperatorBase):
    """记录输入与输出形状，供表格算子的结果面使用。"""

    INPUTS = (FRAME_PORT,)
    OUTPUTS = (FRAME_PORT,)
    ENABLED_IN_SERVING = False

    def __init__(self, config: object) -> None:
        from_config = self.CONFIG_MODEL.model_validate(config)
        super().__init__(from_config)
        self._before: Frame | None = None
        self._after: Frame | None = None

    def run(self, inputs: dict[str, object]) -> dict[str, Frame]:
        """执行变换并检查输出容量。Args: inputs。"""
        for value in inputs.values():
            if isinstance(value, Frame):
                check_capacity(value.row_count, value.columns)
        result = self.transform(inputs)
        check_capacity(result.row_count, result.columns)
        self._before = next(
            value for value in inputs.values() if isinstance(value, Frame)
        )
        self._after = result
        return {"frame": result}

    def transform(self, inputs: dict[str, object]) -> Frame:
        """生成输出帧。Args: inputs。"""
        raise NotImplementedError

    def numeric_columns(
        self, frame: Frame, configured: Sequence[str]
    ) -> tuple[str, ...]:
        """排除运行计划中的目标列。Args: frame, configured。"""
        target = (
            None
            if self.split_plan is None
            else self.split_plan.get("target_column")
        )
        keys = tuple(configured) or tuple(
            column.key
            for column in frame.columns
            if column.dtype == DTYPE_NUMBER
            and column.role != ROLE_TARGET
            and column.key != target
        )
        if not keys:
            raise OperatorError("没有可处理的非目标数值列")
        return selected_keys(frame, keys, is_numeric=True)

    def report(self) -> tuple[ReportBlock, ...]:
        before, after = self._before, self._after
        if before is None or after is None:
            return ()
        return (
            rows_block(
                BlockAt(zone="step", title=f"{self.NAME}的行数", port="frame"),
                RowCounts(
                    before=before.row_count,
                    after=after.row_count,
                    dropped=max(0, before.row_count - after.row_count),
                ),
            ),
            columns_block(
                BlockAt(zone="step", title="输出列", port="frame"),
                ColumnChange(
                    added=tuple(
                        key for key in after.keys if key not in before.keys
                    ),
                    removed=tuple(
                        key for key in before.keys if key not in after.keys
                    ),
                    kept=len(after.columns),
                    reason=self.DESCRIPTION,
                ),
            ),
        )


def selected_keys(
    frame: Frame, keys: Sequence[str], *, is_numeric: bool = False
) -> tuple[str, ...]:
    """检查选列并保持顺序。Args: frame, keys, is_numeric。"""
    selected = tuple(keys) or (
        tuple(
            column.key
            for column in frame.columns
            if column.dtype == DTYPE_NUMBER and column.role != ROLE_TARGET
        )
        if is_numeric
        else frame.keys
    )
    if len(selected) > MAX_COLUMNS or len(selected) != len(set(selected)):
        raise OperatorError("选择的列不能重复且不能超过 256 列")
    for key in selected:
        column = frame.column_of(key)
        if is_numeric and column.dtype != DTYPE_NUMBER:
            raise OperatorError(f"列「{key}」不是数值列")
    if not selected:
        raise OperatorError("没有可处理的列，请选择至少一列")
    return selected


def finite(value: float, *, on_invalid: str = "error") -> float | None:
    """拒绝非有限结果或按显式策略留空。Args: value, on_invalid。"""
    if math.isfinite(value):
        return value
    if on_invalid == "null":
        return None
    raise OperatorError("计算产生非有限数值，请调整参数或选择无效结果留空")


def appended(
    frame: Frame,
    columns: Sequence[FrameColumn],
    values: Sequence[Sequence[CellValue]],
) -> Frame:
    """追加命名列并拒绝覆盖已有列。Args: frame, columns, values。"""
    names = (*frame.keys, *(column.key for column in columns))
    if len(names) != len(set(names)):
        raise OperatorError("输出列名与已有列重复，请修改输出名称或前缀")
    check_capacity(frame.row_count, (*frame.columns, *columns))
    return replace(
        frame,
        columns=(*frame.columns, *columns),
        rows=tuple(
            (*row, *(column[seat] for column in values))
            for seat, row in enumerate(frame.rows)
        ),
    )


def check_capacity(rows: int, columns: Sequence[FrameColumn]) -> None:
    """在展开矩阵前拒绝过大结果。Args: rows, columns。"""
    if rows > MAX_ROWS or len(columns) > MAX_COLUMNS:
        raise OperatorError("数据超过 200000 行或 256 列，请缩小数据范围")
    if any(len(column.key) > MAX_COLUMN_KEY for column in columns):
        raise OperatorError("输出列名超过 256 字符，请缩短名称、前缀或后缀")


def merged_provenance(left: Provenance, right: Provenance) -> Provenance:
    """合并来源与查询范围并保留截断信号。Args: left, right。"""
    starts = [value for value in (left.since, right.since) if value is not None]
    ends = [value for value in (left.until, right.until) if value is not None]
    observed = (left.observed_until, right.observed_until)
    return Provenance(
        table_codes=tuple(
            dict.fromkeys((*left.table_codes, *right.table_codes))
        ),
        since=min(starts) if starts else None,
        until=max(ends) if ends else None,
        is_truncated=left.is_truncated or right.is_truncated,
        observed_until=(
            min(value for value in observed if value is not None)
            if all(value is not None for value in observed)
            else None
        ),
    )
