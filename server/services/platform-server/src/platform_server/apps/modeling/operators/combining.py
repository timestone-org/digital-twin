"""有界按键关联与两路帧纵向合并。"""

from dataclasses import replace
from typing import Literal

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    ColumnsByPort,
    OperatorConfig,
    OperatorError,
    PortSpec,
    column_field,
)
from platform_server.apps.modeling.operators.frame import (
    CellValue,
    Frame,
    FrameColumn,
    frame_input,
)
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.tabular import (
    MAX_ROWS,
    FrameOperator,
    check_capacity,
    merged_provenance,
)

TWO_INPUTS = (
    PortSpec(name="left", contract=CONTRACT_FRAME, label="左表"),
    PortSpec(name="right", contract=CONTRACT_FRAME, label="右表"),
)


class KeyJoinConfig(OperatorConfig):
    """右键唯一的多对一关联参数。"""

    left_key: str = column_field(
        title="左表关联列", description="左表中用于匹配的业务标识"
    )
    right_key: str = column_field(
        title="右表关联列",
        description="右表该列的非空值必须唯一；空值不参与匹配",
    )
    how: Literal["left", "inner"] = Field(
        default="left",
        title="保留哪些行",
        description="left=保留全部左表行；inner=仅保留匹配成功行",
    )
    right_prefix: str = Field(
        default="right_",
        min_length=1,
        max_length=32,
        title="右表列名前缀",
        description="为右表全部输出列添加前缀，避免覆盖左表列",
    )


@register_operator
class KeyJoin(FrameOperator):
    CODE = "key_join"
    NAME = "按业务键关联"
    DESCRIPTION = (
        "按相同类型的业务键关联，右键必须唯一，空键不匹配，保留左表时刻"
    )
    CATEGORY = "preprocess"
    ICON = "table"
    CONFIG_MODEL = KeyJoinConfig
    INPUTS = TWO_INPUTS
    CHANGES_ROW_COUNT = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        left, right = frame_input(inputs, "left"), frame_input(inputs, "right")
        config = KeyJoinConfig.model_validate(self.config.model_dump())
        left_position = left.position_of(config.left_key)
        right_position = right.position_of(config.right_key)
        if (
            left.columns[left_position].dtype
            != right.columns[right_position].dtype
        ):
            raise OperatorError("左右关联列类型不同，请先使用类型归一算子")
        lookup = _right_lookup(right, right_position)
        columns = left.columns + tuple(
            replace(
                column,
                key=f"{config.right_prefix}{column.key}",
                name=f"{config.right_prefix}{column.name}",
            )
            for column in right.columns
        )
        if len({column.key for column in columns}) != len(columns):
            raise OperatorError("右表前缀仍与左表列名冲突，请更换前缀")
        check_capacity(left.row_count, columns)
        rows: list[tuple[CellValue, ...]] = []
        seats: list[int] = []
        blanks: tuple[CellValue, ...] = (None,) * len(right.columns)
        for seat, row in enumerate(left.rows):
            matched = lookup.get(row[left_position])
            if matched is not None or config.how == "left":
                rows.append(
                    (*row, *(matched if matched is not None else blanks))
                )
                seats.append(seat)
        return replace(
            left,
            columns=columns,
            rows=tuple(rows),
            index=(
                None
                if left.index is None
                else tuple(left.index[seat] for seat in seats)
            ),
            provenance=merged_provenance(left.provenance, right.provenance),
        )

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        parsed = KeyJoinConfig.model_validate(config.model_dump())
        left, right = inputs.get("left"), inputs.get("right")
        return {
            "frame": (
                None
                if left is None or right is None
                else (*left, *(f"{parsed.right_prefix}{key}" for key in right))
            )
        }


def _right_lookup(
    frame: Frame, position: int
) -> dict[CellValue, tuple[CellValue, ...]]:
    lookup: dict[CellValue, tuple[CellValue, ...]] = {}
    for row in frame.rows:
        key = row[position]
        if key is None:
            continue
        if key in lookup:
            raise OperatorError(
                "右表关联键存在重复值，请先按业务规则去重或分组汇总"
            )
        lookup[key] = row
    return lookup


class ConcatRowsConfig(OperatorConfig):
    """纵向合并时的列匹配口径。"""

    columns_mode: Literal["strict", "union"] = Field(
        default="strict",
        title="列匹配方式",
        description="strict=两表列名集合一致；union=保留两表列的并集，缺列留空",
    )


@register_operator
class ConcatRows(FrameOperator):
    CODE = "concat_rows"
    NAME = "纵向合并"
    DESCRIPTION = "左表行在前、右表行在后；按列名对齐，类型、角色和单位必须一致"
    CATEGORY = "preprocess"
    ICON = "table"
    CONFIG_MODEL = ConcatRowsConfig
    INPUTS = TWO_INPUTS
    CHANGES_ROW_COUNT = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        left, right = frame_input(inputs, "left"), frame_input(inputs, "right")
        config = ConcatRowsConfig.model_validate(self.config.model_dump())
        if left.row_count + right.row_count > MAX_ROWS:
            raise OperatorError("合并超过 200000 行，请缩小两表范围")
        if (left.index is None) != (right.index is None):
            raise OperatorError("两表必须都有时间索引，或都没有时间索引")
        if left.index_name != right.index_name:
            raise OperatorError("两表时间索引名称不同，请统一索引口径")
        columns = _concat_columns(left, right, config.columns_mode)
        check_capacity(left.row_count + right.row_count, columns)
        rows = _project_rows(left, columns) + _project_rows(right, columns)
        return replace(
            left,
            columns=columns,
            rows=rows,
            index=(
                None
                if left.index is None or right.index is None
                else left.index + right.index
            ),
            provenance=merged_provenance(left.provenance, right.provenance),
        )

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        parsed = ConcatRowsConfig.model_validate(config.model_dump())
        left, right = inputs.get("left"), inputs.get("right")
        if left is None or right is None:
            return {"frame": None}
        return {
            "frame": (
                left
                if parsed.columns_mode == "strict"
                else tuple(dict.fromkeys((*left, *right)))
            )
        }


def _concat_columns(
    left: Frame, right: Frame, mode: str
) -> tuple[FrameColumn, ...]:
    if mode == "strict" and set(left.keys) != set(right.keys):
        raise OperatorError("严格合并要求两表列名集合一致")
    for column in right.columns:
        if column.key in left.keys:
            existing = left.column_of(column.key)
            if (existing.dtype, existing.role, existing.unit) != (
                column.dtype,
                column.role,
                column.unit,
            ):
                raise OperatorError(
                    f"列「{column.key}」的类型、角色或单位不一致"
                )
    return (
        *left.columns,
        *(column for column in right.columns if column.key not in left.keys),
    )


def _project_rows(
    frame: Frame, columns: tuple[FrameColumn, ...]
) -> tuple[tuple[CellValue, ...], ...]:
    positions = {column.key: seat for seat, column in enumerate(frame.columns)}
    return tuple(
        tuple(
            row[positions[column.key]] if column.key in positions else None
            for column in columns
        )
        for row in frame.rows
    )
