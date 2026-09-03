"""把取好的历史行与模型定义折算成求值器要的 `externals`。

取数（异步，调用方做）与折算（纯同步，这里）分成两段。
⚠ 五类引用**整份**收，不拆成五个可省的入参：省掉一类不会报错，只会让那一类
引用悄悄读到空值——试算就是这么与落库算出了两个不同的数
（docs/DATASET_DESIGN.md §5.6）。
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, tzinfo

from platform_server.apps.dataset.formula.analysis import (
    AnalysisModel,
    AnalysisUnavailable,
    ModelMemo,
)
from platform_server.apps.dataset.formula.errors import FormulaError
from platform_server.apps.dataset.formula.evaluator import ExternalKey
from platform_server.apps.dataset.formula.refs import FormulaDeps, WindowRef
from platform_server.apps.dataset.formula.values import to_number
from platform_server.apps.dataset.formula.windows import (
    WindowSpec,
    window_lower_bound,
)


@dataclass(frozen=True)
class RowSnapshot:
    """一条行在求值视角下的样子：时刻 + 全部列值（原始值 ∪ 计算值）。"""

    ts: datetime
    values: dict[str, object]

    def get(self, key: str) -> object:
        """取一列的值。

        Args: key。
        """
        return self.values.get(key)


@dataclass(frozen=True)
class WholeStats:
    """某一列在**整表**上的聚合底数。

    只存四个可加的原始量，五个 `*_ALL` 都由它们导出——于是一列查一次就够。
    """

    minimum: float | None = None
    maximum: float | None = None
    total: float | None = None
    count: int = 0

    def fold(self, value: object) -> "WholeStats":
        """把一个尚未入库的值并进统计。

        ⚠ 新建或编辑一行时，这一行还不在库里（或库里是旧值）。不并进来的话，
        当这一行正好是新的极值时，`({值}-MIN_ALL)/(MAX_ALL-MIN_ALL)` 会算出
        越界的数（docs/DATASET_DESIGN.md §5.6）。
        Args: value。
        """
        try:
            number = to_number(value, where="整列聚合")
        except FormulaError:
            return self
        if number is None:
            return self
        return WholeStats(
            minimum=(
                number if self.minimum is None else min(self.minimum, number)
            ),
            maximum=(
                number if self.maximum is None else max(self.maximum, number)
            ),
            total=number if self.total is None else self.total + number,
            count=self.count + 1,
        )


@dataclass
class HistoryCache:
    """一次求值要用到的历史行。"""

    #: 按日历回推月/年时用的业务时区。⚠ 没有默认值：默认成 UTC 的话，东八区的
    #: 月度台账会静默差一天，而两边看起来都对
    tz: tzinfo
    #: 当前行之前的行，按 ts **降序**（[0] 即上一行）
    prev_rows: list[RowSnapshot] = field(default_factory=list[RowSnapshot])
    #: {窗口规范写法: 该窗口内的历史行（升序，不含当前行）}
    #: ⚠ 键用字面量而非秒数：月与年的长度不定
    window_rows: dict[str, list[RowSnapshot]] = field(
        default_factory=dict[str, list[RowSnapshot]]
    )
    #: {列key: 整列聚合底数}
    whole_stats: dict[str, WholeStats] = field(
        default_factory=dict[str, WholeStats]
    )
    #: {表code: 对方表的行（按 ts 升序）}，用于 as-of 取值
    #: 这一批共用的模型定义。⚠ 一次重算装一次、全批复用：模型版本不可变，
    #: 故一批算完之前不会换定义——换了就是同一批数据按两套口径算出来
    models: dict[str, "AnalysisModel | AnalysisUnavailable"] = field(
        default_factory=dict[str, "AnalysisModel | AnalysisUnavailable"]
    )
    #: 这一批共用的 `PREDICT` 备忘；`None` 表示这一批没开批量相位。
    #: ⚠ 与 `models` 一样是**整批一份**：每行新造一个的话备忘永远命不中，
    #: 而那不会报错，只是批量相位白跑一趟
    model_memo: "ModelMemo | None" = None
    external_rows: dict[str, list[RowSnapshot]] = field(
        default_factory=dict[str, list[RowSnapshot]]
    )


def empty_cache() -> HistoryCache:
    """一份什么都没取的缓存。试算用它——读不到历史，四类引用一律算空。"""
    return HistoryCache(tz=UTC)


def build_externals(
    deps: FormulaDeps, cache: HistoryCache, current: RowSnapshot | None
) -> dict[ExternalKey, object]:
    """把历史行折算成求值器要的 externals。

    Args: deps（一条公式的全部依赖，整份进来）, cache, current（当前行；
        本表窗口含当前行，缺行或缺列则不贡献）。
    """
    externals: dict[ExternalKey, object] = {}
    for model in deps.model:
        externals[("model", model.code)] = cache.models.get(
            model.code, AnalysisUnavailable(reason="模型未绑定")
        )
    for ref in deps.external:
        row = _as_of(cache.external_rows.get(ref.table_code) or [], current)
        externals[("ext", ref.table_code, ref.key)] = (
            None if row is None else row.get(ref.key)
        )
    for whole in deps.whole:
        externals[("all", whole.func, whole.key)] = _whole_value(
            whole.func, cache.whole_stats.get(whole.key)
        )
    for prev in deps.prev:
        # prev_rows 是降序的：往前第 n 条 = 下标 n-1
        index = prev.steps - 1
        row = cache.prev_rows[index] if index < len(cache.prev_rows) else None
        externals[("prev", prev.key, prev.steps)] = (
            None if row is None else row.get(prev.key)
        )
    for window in deps.window:
        externals[("win", window.func, window.key, window.spec.literal)] = (
            _window_value(window, cache, current)
        )
    return externals


def _window_value(
    ref: WindowRef, cache: HistoryCache, current: RowSnapshot | None
) -> object:
    """一个时间窗聚合的值。

    ⚠ 没有当前行（试算）时整个窗口是**未知**，一律给空——包括 `COUNT_OVER`。
    给 0 等于断言「这一段一条记录都没有」，而事实是压根没去查
    （docs/DATASET_DESIGN.md §5.5 空与零永远分开）。
    Args: ref, cache, current。
    """
    if current is None:
        return None
    if ref.table_code is not None:
        # ⚠ 跨表窗口**不含当前行**：当前行属于本表，并进去是凭空多一个值，
        # 而两张表有同名列时尤其难发现（docs/DATASET_DESIGN.md §5.6）
        rows = _slice_window(
            cache.external_rows.get(ref.table_code) or [],
            current.ts,
            ref.spec,
            cache.tz,
        )
        return _aggregate(ref.func, rows, ref.column_key)
    # ⚠ 这里**再切一次**窗口，不假定取数层切得刚好：取多了不会报错，只会让
    # 「近 1 小时」悄悄算成近一天，而两边的代码单看都对
    rows = _slice_window(
        cache.window_rows.get(ref.spec.literal, ()),
        current.ts,
        ref.spec,
        cache.tz,
    )
    # 当前行参与本表窗口：仅当它确实持有该列的值——公式列引用自身窗口时不成立，
    # 这正是 `SUM_OVER({自己}, '1y')` 不构成环的原因
    if current.values.get(ref.key) is not None:
        rows = sorted([*rows, current], key=lambda row: row.ts)
    return _aggregate(ref.func, rows, ref.key)


def _slice_window(
    rows: Iterable[RowSnapshot], ts: datetime, spec: WindowSpec, tz: tzinfo
) -> list[RowSnapshot]:
    """从一串升序的行里切出 `(下界, ts]`。

    Args: rows, ts, spec, tz。
    """
    lower = window_lower_bound(ts, spec, tz)
    return [row for row in rows if lower < row.ts <= ts]


def _as_of(
    rows: list[RowSnapshot], current: RowSnapshot | None
) -> RowSnapshot | None:
    """取 ts ≤ 当前行时刻的最后一行（rows 已升序，二分查找）。

    Args: rows, current。
    """
    if current is None:
        return None
    low, high = 0, len(rows)
    while low < high:
        middle = (low + high) // 2
        if rows[middle].ts <= current.ts:
            low = middle + 1
        else:
            high = middle
    return rows[low - 1] if low > 0 else None


def _numeric_series(rows: Iterable[RowSnapshot], key: str) -> list[float]:
    """窗口内某列的数值序列。

    ⚠ 空值与转不成数的脏值一并**跳过**，不报错——一个窗口横跨很多行，一格脏
    数据不该毙掉整条公式（与单值算术的「类型不匹配才报错」刻意不同）。
    Args: rows, key。
    """
    series: list[float] = []
    for row in rows:
        raw = row.get(key)
        if raw is None:
            continue
        try:
            number = to_number(raw, where="窗口聚合")
        except FormulaError:
            continue
        if number is not None:
            series.append(number)
    return series


_SERIES_REDUCERS: dict[str, Callable[[list[float]], float]] = {
    "SUM_OVER": sum,
    "AVG_OVER": lambda series: sum(series) / len(series),
    "MIN_OVER": min,
    "MAX_OVER": max,
}
_WHOLE_DERIVERS: dict[str, Callable[[WholeStats], float | None]] = {
    "MIN_ALL": lambda stats: stats.minimum,
    "MAX_ALL": lambda stats: stats.maximum,
    "SUM_ALL": lambda stats: stats.total,
    "AVG_ALL": lambda stats: (
        None if stats.total is None else stats.total / stats.count
    ),
}


def _aggregate(func: str, rows: list[RowSnapshot], key: str) -> object:
    """按窗口函数名折算一个标量。rows 已按 ts 升序。

    Args: func, rows, key。
    """
    if func == "COUNT_OVER":
        # ⚠ 数的是**有没有值**，不是能不能转成数，空白串也算一条
        return float(sum(1 for row in rows if row.get(key) is not None))
    if func == "FIRST_OVER":
        return _first_present(rows, key)
    if func == "LAST_OVER":
        return _first_present(list(reversed(rows)), key)
    series = _numeric_series(rows, key)
    if func == "ALL_ZERO_OVER":
        # ⚠ 窗口里一个值都没有时给**空**而不是真：「都是 0」与「什么都没有」
        # 是两回事，混成一档会让一张刚建好的空表直接走进归零那一支
        return None if not series else all(value == 0 for value in series)
    reducer = _SERIES_REDUCERS.get(func)
    if reducer is None:  # pragma: no cover - 名单由契约测试锁死
        raise FormulaError(f"未实现的窗口函数 {func}")
    return reducer(series) if series else None


def _first_present(rows: list[RowSnapshot], key: str) -> object:
    """第一条持有该列值的行的**原值**（不转数）。

    Args: rows, key。
    """
    for row in rows:
        value = row.get(key)
        if value is not None:
            return value
    return None


def _whole_value(func: str, stats: WholeStats | None) -> object:
    """由整列底数导出某个 `*_ALL` 的值。

    ⚠ `stats is None`（这一列压根没取过数）给**空**，而空表上的 `COUNT_ALL`
    给 **0**：「不知道」与「没有」不是一回事。
    Args: func, stats。
    """
    if stats is None:
        return None
    if func == "COUNT_ALL":
        return float(stats.count)
    if stats.count == 0:
        return None
    deriver = _WHOLE_DERIVERS.get(func)
    if deriver is None:  # pragma: no cover - 名单由契约测试锁死
        raise FormulaError(f"未实现的整列聚合函数 {func}")
    return deriver(stats)
