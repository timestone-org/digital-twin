"""把取好的历史行与模型定义折算成求值器要的 `externals`。

取数（异步，调用方做）与折算（纯同步，这里）分成两段。
⚠ 五类引用**整份**收，不拆成五个可省的入参：省掉一类不会报错，只会让那一类
引用悄悄读到空值——试算就是这么与落库算出了两个不同的数
（docs/DATASET_DESIGN.md §5.6）。
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, tzinfo
from decimal import Context, Decimal

from platform_server.apps.dataset.formula.analysis import (
    AnalysisModel,
    AnalysisUnavailable,
    ModelMemo,
)
from platform_server.apps.dataset.formula.complete_windows import (
    sum_complete_window,
)
from platform_server.apps.dataset.formula.errors import FormulaError
from platform_server.apps.dataset.formula.evaluator import ExternalKey
from platform_server.apps.dataset.formula.refs import FormulaDeps, WindowRef
from platform_server.apps.dataset.formula.snapshot import RowSnapshot
from platform_server.apps.dataset.formula.values import (
    finite,
    is_blank,
    to_number,
)
from platform_server.apps.dataset.formula.window_index import (
    WindowIndex,
    WindowSlice,
    ts_bounds,
)
from platform_server.apps.dataset.formula.windows import window_lower_bound

# binary64 采样最小至 1e-324，bigint 行数的总量小于 1e328。
_AGGREGATE_PRECISION = 660


def _extreme(
    left: float | None,
    right: float | None,
    pick: Callable[[float, float], float],
) -> float | None:
    """合并两组可能为空的极值。Args: left, right, pick。"""
    if left is None:
        return right
    return left if right is None else pick(left, right)


@dataclass(frozen=True)
class WholeStats:
    """一列的数值样本、极值、总和与其他非空值数。"""

    minimum: float | None = None
    maximum: float | None = None
    total: Decimal | float | None = None
    count: int = 0  # 有限数值样本数
    non_numeric_count: int = 0

    @property
    def present_count(self) -> int:
        """全部在场值的个数。"""
        return self.count + self.non_numeric_count

    def average(self) -> float | None:
        """仅以可转成有限数值的样本为分母。"""
        if (
            self.total is None
            or self.count == 0
            or finite(float(self.total)) is None
        ):
            return None
        return float(
            Context(prec=_AGGREGATE_PRECISION).divide(
                Decimal(str(self.total)), Decimal(self.count)
            )
        )

    def merge(self, other: "WholeStats") -> "WholeStats":
        """合并两组底数。Args: other。"""
        total = self.total if other.total is None else other.total
        if self.total is not None and other.total is not None:
            total = Context(prec=_AGGREGATE_PRECISION).add(
                Decimal(str(self.total)), Decimal(str(other.total))
            )
        return WholeStats(
            minimum=_extreme(self.minimum, other.minimum, min),
            maximum=_extreme(self.maximum, other.maximum, max),
            total=total,
            count=self.count + other.count,
            non_numeric_count=self.non_numeric_count + other.non_numeric_count,
        )

    def fold(self, value: object, *, occurrences: int = 1) -> "WholeStats":
        """将一个值或若干相同值并入底数。Args: value, occurrences。"""
        if is_blank(value) or (
            isinstance(value, float) and finite(value) is None
        ):
            return self
        try:
            number = to_number(value, where="整列聚合")
        except FormulaError:
            number = None
        if number is None:
            return replace(
                self, non_numeric_count=self.non_numeric_count + occurrences
            )
        subtotal = Context(prec=_AGGREGATE_PRECISION).multiply(
            Decimal(str(number)), Decimal(occurrences)
        )
        return self.merge(WholeStats(number, number, subtotal, occurrences))


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
    #: 窗口聚合的增量索引。⚠ 整表重算要让一趟里的每一行共用同一份：每行新造
    #: 一份就退回「每行把整个窗口重转一遍数」，1 分钟台账的今日窗是平方级
    window_index: WindowIndex = field(default_factory=WindowIndex)


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
        rows = cache.external_rows.get(ref.table_code) or []
        return _window_aggregate(ref, cache, rows, current.ts, None)
    # 当前行参与本表窗口：仅当它确实持有该列的值——公式列引用自身窗口时不成立，
    # 这正是 `SUM_OVER({自己}, '1y')` 不构成环的原因
    joins = (
        current.values.get(ref.key) is not None or ref.spec.step_s is not None
    )
    rows = cache.window_rows.get(ref.spec.literal, ())
    return _window_aggregate(
        ref, cache, rows, current.ts, current if joins else None
    )


def _window_aggregate(
    ref: WindowRef,
    cache: HistoryCache,
    rows: Sequence[RowSnapshot],
    ts: datetime,
    extra: RowSnapshot | None,
) -> object:
    """在升序行串里切出 `(下界, ts]`（今日窗下界闭），按窗口口径聚合。

    ⚠ 这里**再切一次**窗口，不假定取数层切得刚好：取多了不会报错，只会让
    「近 1 小时」悄悄算成近一天，而两边的代码单看都对。
    Args: ref, cache, rows（⚠ 必须按 ts 升序）, ts, extra（并进窗口的当前行）。
    """
    lower = window_lower_bound(ts, ref.spec, cache.tz)
    start, end = ts_bounds(rows, lower, ts, is_closed=ref.spec.is_today)
    if ref.spec.step_s is not None:
        picked = [*rows[start:end], *([] if extra is None else [extra])]
        return sum_complete_window(
            ((row.ts, row.get(ref.column_key)) for row in picked),
            lower,
            ts,
            ref.spec.step_s,
        )
    column = cache.window_index.column(rows, ref.column_key)
    return _aggregate(
        ref.func, WindowSlice(column, start, end, ref.column_key, extra)
    )


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


_SERIES_REDUCERS: dict[str, Callable[[list[float]], float]] = {
    "SUM_OVER": sum,
    "AVG_OVER": lambda series: sum(series) / len(series),
    "MIN_OVER": min,
    "MAX_OVER": max,
}
_WHOLE_DERIVERS: dict[str, Callable[[WholeStats], float | None]] = {
    "MIN_ALL": lambda stats: stats.minimum,
    "MAX_ALL": lambda stats: stats.maximum,
    "SUM_ALL": lambda stats: (
        None if stats.total is None else float(stats.total)
    ),
    "AVG_ALL": WholeStats.average,
}


def _aggregate(func: str, window: WindowSlice) -> object:
    """按窗口函数名折算一个标量。

    Args: func, window。
    """
    if func == "COUNT_OVER":
        # ⚠ 数的是**有没有值**，不是能不能转成数，空白串也算一条
        return float(window.count())
    if func == "FIRST_OVER":
        return window.first()
    if func == "LAST_OVER":
        return window.last()
    series = window.numbers()
    if func == "ALL_ZERO_OVER":
        # ⚠ 窗口里一个值都没有时给**空**而不是真：「都是 0」与「什么都没有」
        # 是两回事，混成一档会让一张刚建好的空表直接走进归零那一支
        return None if not series else all(value == 0 for value in series)
    reducer = _SERIES_REDUCERS.get(func)
    if reducer is None:  # pragma: no cover - 名单由契约测试锁死
        raise FormulaError(f"未实现的窗口函数 {func}")
    return finite(reducer(series)) if series else None


def _whole_value(func: str, stats: WholeStats | None) -> object:
    """由整列底数导出某个 `*_ALL` 的值。

    ⚠ `stats is None`（这一列压根没取过数）给**空**，而空表上的 `COUNT_ALL`
    给 **0**：「不知道」与「没有」不是一回事。
    Args: func, stats。
    """
    if stats is None:
        return None
    if func == "COUNT_ALL":
        return float(stats.present_count)
    if stats.count == 0:
        return None
    deriver = _WHOLE_DERIVERS.get(func)
    if deriver is None:  # pragma: no cover - 名单由契约测试锁死
        raise FormulaError(f"未实现的整列聚合函数 {func}")
    value = deriver(stats)
    return None if value is None else finite(value)
