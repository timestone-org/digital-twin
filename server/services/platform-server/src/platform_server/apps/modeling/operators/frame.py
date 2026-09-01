"""特征帧：流水线里流动的唯一表格载体，以及围着它的几个纯函数。

X 与 y 是同一个矩阵的不同列，故「行数对不对齐」在结构上不可能出错
（docs/MODELING_DESIGN.md D12）。切法只有 `split_row_indices` 一份——切分算子
与「带拟合的算子只在训练行上拟合」用的必须是同一份，两份会让防泄漏静默失效。
"""

from dataclasses import dataclass, replace
from datetime import datetime

import numpy as np

from platform_server.apps.modeling.operators.base import OperatorError

# 列在帧上的用途。目标列由切分算子一次性指定，下游从角色读（设计文档 D13）
ROLE_FEATURE = "feature"
ROLE_TARGET = "target"
ROLE_IGNORED = "ignored"
COLUMN_ROLES: tuple[str, ...] = (ROLE_FEATURE, ROLE_TARGET, ROLE_IGNORED)

DTYPE_NUMBER = "number"
DTYPE_BOOLEAN = "bool"
DTYPE_STRING = "string"
DTYPES: tuple[str, ...] = (DTYPE_NUMBER, DTYPE_BOOLEAN, DTYPE_STRING)

# 时序切分（默认）与随机切分。⚠ 台账数据是时序的，随机切分会让未来数据泄漏
# 进训练集，指标虚高而上线崩
SPLIT_TIME_ORDER = "time_order"
SPLIT_RANDOM = "random"
SPLIT_METHODS: tuple[str, ...] = (SPLIT_TIME_ORDER, SPLIT_RANDOM)
# 切不出两份的下限
_MIN_SPLIT_ROWS = 2

type CellValue = float | bool | str | None


@dataclass(frozen=True)
class FrameColumn:
    """帧上的一列。`key` 是台账列 key，全帧唯一。"""

    key: str
    name: str
    dtype: str
    role: str = ROLE_FEATURE
    unit: str = ""
    # 取数时按列定义的类型转不动、只好当缺失的行数。⚠ 台账 values_json 里的
    # 类型不可信：写入路径的类型收敛只在 API 那一条上生效
    coerce_failed: int = 0


@dataclass(frozen=True)
class Provenance:
    """这份数据是从哪儿、哪一段取来的。一路透传到模型版本指纹。"""

    table_codes: tuple[str, ...] = ()
    since: datetime | None = None
    until: datetime | None = None
    is_truncated: bool = False


@dataclass(frozen=True)
class Frame:
    """一份等宽矩阵：列定义 + 行 + 可空的时间索引。

    ⚠ 缺失一律用 `None` 表示，绝不 coalesce 成 0——台账那一层已经把空值一路
    保持到展示层，建模侧填 0 会把「没测到」变成「测到 0」。
    """

    columns: tuple[FrameColumn, ...]
    rows: tuple[tuple[CellValue, ...], ...]
    index: tuple[int, ...] | None = None
    index_name: str = "ts"
    provenance: Provenance = Provenance()

    @property
    def row_count(self) -> int:
        """行数。"""
        return len(self.rows)

    @property
    def keys(self) -> tuple[str, ...]:
        """列 key，与行内取值同序。"""
        return tuple(column.key for column in self.columns)

    def position_of(self, key: str) -> int:
        """一列在行内的下标；没有这一列就抛。

        Args: key。
        """
        for position, column in enumerate(self.columns):
            if column.key == key:
                return position
        raise OperatorError(f"上游数据里没有列「{key}」")

    def column_of(self, key: str) -> FrameColumn:
        """一列的定义。

        Args: key。
        """
        return self.columns[self.position_of(key)]

    def values_of(self, key: str) -> list[CellValue]:
        """一列的全部取值。

        Args: key。
        """
        position = self.position_of(key)
        return [row[position] for row in self.rows]

    def keys_by_role(self, role: str) -> tuple[str, ...]:
        """某个角色的列 key，保持列序。

        Args: role。
        """
        return tuple(
            column.key for column in self.columns if column.role == role
        )


def frame_input(inputs: dict[str, object], port: str) -> "Frame":
    """从输入里取一个帧端口的负载。

    Args: inputs, port。
    """
    frame = inputs.get(port)
    if not isinstance(frame, Frame):  # pragma: no cover - 引擎已按端口装配
        raise OperatorError(f"输入端口 {port} 上没有数据")
    return frame


def numbers_of(frame: Frame, key: str) -> list[float | None]:
    """取一列的数值。非数值列直接抛，不做隐式转换。

    Args: frame, key。
    """
    column = frame.column_of(key)
    if column.dtype != DTYPE_NUMBER:
        raise OperatorError(f"列「{key}」不是数值列，这一步只能处理数值列")
    return [_as_number(value) for value in frame.values_of(key)]


def numeric_keys(frame: Frame) -> tuple[str, ...]:
    """帧上全部数值列的 key。

    Args: frame。
    """
    return tuple(
        column.key for column in frame.columns if column.dtype == DTYPE_NUMBER
    )


def matrix_of(frame: Frame, keys: tuple[str, ...]) -> list[list[float]]:
    """按给定列拼一个稠密数值矩阵；遇到缺失即抛。

    ⚠ 遇缺失抛而不是丢行：丢行会让 X 与 y 静默错位，而抛出来的话用户看到的是
    「第 N 行的列 X 是空，请先补一个填充步骤」。
    Args: frame, keys。
    """
    columns = [numbers_of(frame, key) for key in keys]
    rows: list[list[float]] = []
    for position in range(frame.row_count):
        row: list[float] = []
        for key, values in zip(keys, columns, strict=True):
            value = values[position]
            if value is None:
                raise OperatorError(
                    f"第 {position + 1} 行的列「{key}」是空值，"
                    "请先加一个填缺失的步骤"
                )
            row.append(value)
        rows.append(row)
    return rows


def with_column_values(
    frame: Frame, key: str, values: list[CellValue]
) -> Frame:
    """换掉一列的取值，其余原样。

    Args: frame, key, values。
    """
    position = frame.position_of(key)
    if len(values) != frame.row_count:
        raise OperatorError(f"列「{key}」的新值行数与帧不一致")
    rows = tuple(
        (*row[:position], values[index], *row[position + 1 :])
        for index, row in enumerate(frame.rows)
    )
    return replace(frame, rows=rows)


def with_roles(frame: Frame, *, target_key: str) -> Frame:
    """把目标列打成 `target`、其余数值列打成 `feature`、非数值列打成 `ignored`。

    Args: frame, target_key。
    """
    frame.position_of(target_key)
    columns = tuple(
        replace(column, role=_role_of(column, target_key))
        for column in frame.columns
    )
    return replace(frame, columns=columns)


def select_rows(frame: Frame, indices: list[int]) -> Frame:
    """按行下标取子集，列定义与出处原样带走。

    Args: frame, indices。
    """
    rows = tuple(frame.rows[index] for index in indices)
    index = (
        None
        if frame.index is None
        else tuple(frame.index[position] for position in indices)
    )
    return replace(frame, rows=rows, index=index)


def split_row_indices(
    row_count: int, *, method: str, test_ratio: float, random_state: int
) -> tuple[list[int], list[int]]:
    """切出训练行与测试行的下标。**全模块唯一的一份切法。**

    ⚠ 切分算子与「带拟合的算子只在训练行上拟合」必须调同一个函数：各写一份的
    话，测试行会悄悄参与拟合（泄漏），而两边各自看起来都对。
    Args: row_count, method, test_ratio, random_state。
    """
    if row_count < _MIN_SPLIT_ROWS:
        raise OperatorError("数据不足两行，切不出训练集与测试集")
    test_size = int(row_count * test_ratio)
    test_size = max(1, min(test_size, row_count - 1))
    if method == SPLIT_RANDOM:
        generator = np.random.default_rng(random_state)
        order = [int(item) for item in generator.permutation(row_count)]
    elif method == SPLIT_TIME_ORDER:
        order = list(range(row_count))
    else:
        raise OperatorError(f"未知的切分方式「{method}」")
    return order[: row_count - test_size], order[row_count - test_size :]


def _role_of(column: FrameColumn, target_key: str) -> str:
    if column.key == target_key:
        return ROLE_TARGET
    return ROLE_FEATURE if column.dtype == DTYPE_NUMBER else ROLE_IGNORED


def _as_number(value: CellValue) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        raise OperatorError("数值列里混进了文本，取数那一步没有归一类型")
    return float(value)
