"""窗口聚合的增量索引：一串行上每列只转一次数，切窗变成二分 + 切片。

⚠ 只对**只追加**的行序列成立——整表重算那一趟的历史串与跨表行都是这么用的。
换了一串行（按身份认）或行数变少都整份重建，不拿旧账。
"""

from bisect import bisect_left, bisect_right
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime

from platform_server.apps.dataset.formula.errors import FormulaError
from platform_server.apps.dataset.formula.snapshot import RowSnapshot
from platform_server.apps.dataset.formula.values import to_number


def window_number(raw: object) -> float | None:
    """窗口聚合眼里的一格数值；空与转不成数的脏值都是 None。

    ⚠ 脏值跳过不报错：一个窗口横跨很多行，一格脏数据不该毙掉整条公式。
    Args: raw。
    """
    if raw is None:
        return None
    try:
        return to_number(raw, where="窗口聚合")
    except FormulaError:
        return None


@dataclass
class ColumnIndex:
    """一串行上某一列的索引。位置都是行在串里的下标，升序。"""

    rows: Sequence[RowSnapshot]
    seen: int = 0
    present_at: list[int] = field(default_factory=list[int])
    numeric_at: list[int] = field(default_factory=list[int])
    numbers: list[float] = field(default_factory=list[float])

    def catch_up(self, key: str) -> None:
        """把上次之后新追加的行并进来。

        Args: key。
        """
        for position in range(self.seen, len(self.rows)):
            raw = self.rows[position].get(key)
            if raw is None:
                continue
            self.present_at.append(position)
            number = window_number(raw)
            if number is not None:
                self.numeric_at.append(position)
                self.numbers.append(number)
        self.seen = len(self.rows)


@dataclass(frozen=True)
class WindowSlice:
    """一列在行下标 `[start, end)` 上的窗口，外加一条可选的当前行。"""

    column: ColumnIndex
    start: int
    end: int
    key: str
    extra: RowSnapshot | None = None

    def count(self) -> int:
        """有值（不为空）的格数。"""
        inside = bisect_left(self.column.present_at, self.end) - bisect_left(
            self.column.present_at, self.start
        )
        return inside + (0 if self._extra_raw() is None else 1)

    def first(self) -> object:
        """第一格有值的原值（不转数）。"""
        at = bisect_left(self.column.present_at, self.start)
        if at < len(self.column.present_at):
            position = self.column.present_at[at]
            if position < self.end:
                return self.column.rows[position].get(self.key)
        return self._extra_raw()

    def last(self) -> object:
        """最后一格有值的原值（不转数）。"""
        extra = self._extra_raw()
        if extra is not None:
            return extra
        at = bisect_left(self.column.present_at, self.end) - 1
        if at >= 0 and self.column.present_at[at] >= self.start:
            return self.column.rows[self.column.present_at[at]].get(self.key)
        return None

    def numbers(self) -> list[float]:
        """窗口内的数值序列，按行序；空与脏值已跳过。"""
        low = bisect_left(self.column.numeric_at, self.start)
        high = bisect_left(self.column.numeric_at, self.end)
        series = self.column.numbers[low:high]
        extra = window_number(self._extra_raw())
        if extra is not None:
            series.append(extra)
        return series

    def _extra_raw(self) -> object:
        """当前行在这一列上的原值。"""
        return None if self.extra is None else self.extra.get(self.key)


@dataclass
class WindowIndex:
    """一趟求值共用的索引簿：{(行串身份, 列): 索引}。"""

    columns: dict[tuple[int, str], ColumnIndex] = field(
        default_factory=dict[tuple[int, str], ColumnIndex]
    )

    def column(self, rows: Sequence[RowSnapshot], key: str) -> ColumnIndex:
        """取（并追平）某串行上某列的索引。

        ⚠ 条目里攥着行串本身：身份只靠 `id()` 的话，旧串被回收后新串可能复用
        同一个 id，拿到的就是上一串的账。
        Args: rows, key。
        """
        slot = (id(rows), key)
        entry = self.columns.get(slot)
        if entry is None or entry.rows is not rows or entry.seen > len(rows):
            entry = ColumnIndex(rows=rows)
            self.columns[slot] = entry
        entry.catch_up(key)
        return entry


def ts_bounds(
    rows: Sequence[RowSnapshot],
    lower: datetime,
    upper: datetime,
    *,
    is_closed: bool,
) -> tuple[int, int]:
    """`(lower, upper]`（下界闭时 `[lower, upper]`）在升序行串里的下标区间。

    Args: rows（⚠ 必须按 ts 升序）, lower, upper, is_closed（下界闭不闭）。
    """
    locate = bisect_left if is_closed else bisect_right
    start = locate(rows, lower, key=_row_ts)
    return start, bisect_right(rows, upper, key=_row_ts)


def _row_ts(row: RowSnapshot) -> datetime:
    """二分用的键。Args: row。"""
    return row.ts
