"""公式求值要用到的历史行：跨行 / 时间窗 / 整列 / 跨表四类，全在这里取。

取数（异步，这一层）与求值（纯同步，`formula` 包）分成两段。⚠ 四类**一次装齐**：
少装一类不会报错，只会让那一类引用悄悄读到空值，而界面上它与「数据本身就是空」
分不开（docs/DATASET_DESIGN.md §5.6）。
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, tzinfo
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.crud import (
    RecordWindow,
    WholeStatsRow,
    record_crud,
)
from platform_server.apps.dataset.formula import (
    ComputePlan,
    HistoryCache,
    RowSnapshot,
    WholeStats,
    WindowRef,
    WindowSpec,
    window_lower_bound,
)
from platform_server.apps.dataset.services.effective import to_snapshot


@dataclass(frozen=True)
class ComputeScope:
    """一次算数的全部静态输入：算什么、跨表编码怎么解析、按哪个时区回推日历。"""

    plan: ComputePlan
    #: 全部台账的 `{编码: id}`。公式里写的是编码，取数要的是 id
    table_ids: dict[str, uuid.UUID]
    #: 业务时区。⚠ 月/年窗口按它的日历回推，换成 UTC 会让东八区凌晨那几个
    #: 小时的行静默落进上一个月
    timezone: tzinfo

    @property
    def max_prev(self) -> int:
        """最远要回看几行。"""
        return max(
            (ref.steps for ref in self.plan.prev_refs),
            default=0,
        )

    @property
    def local_windows(self) -> set[WindowSpec]:
        """本表的时间窗规范。"""
        return {
            ref.spec for ref in self.plan.window_refs if ref.table_code is None
        }

    @property
    def external_windows(self) -> list[WindowRef]:
        """跨表的时间窗引用。"""
        return [
            ref for ref in self.plan.window_refs if ref.table_code is not None
        ]


@dataclass(frozen=True)
class RowTarget:
    """要算的那一行的定位。"""

    table_id: uuid.UUID
    ts: datetime
    #: 编辑既有行时排除库里那份旧值——不排就是拿旧值和新值各算一遍
    exclude_row_id: uuid.UUID | None = None
    #: 尚未入库的当前行值，折进整列聚合底数用
    current_values: dict[str, Any] | None = None


@dataclass(frozen=True)
class WholeRefKey:
    """一处整列引用：出参键（可能带表前缀）与它在对方表里的列 key。"""

    reference: str
    column: str


@dataclass(frozen=True)
class RowSpan:
    """一批要算的行覆盖的时刻区间。单行时首末相同。"""

    table_id: uuid.UUID
    start: datetime
    end: datetime


async def load_history(
    session: AsyncSession, scope: ComputeScope, target: RowTarget
) -> HistoryCache:
    """为「算某一行」把四类历史一次取齐。

    Args: session, scope, target。
    """
    cache = HistoryCache(tz=scope.timezone)
    if not scope.plan.needs_history:
        return cache
    span = RowSpan(table_id=target.table_id, start=target.ts, end=target.ts)
    cache.external_rows = await load_external_rows(session, scope, span)
    cache.whole_stats = fold_current(
        await load_whole_stats(session, scope, target), target.current_values
    )
    cache.prev_rows = await _load_prev(session, scope, target)
    cache.window_rows = await _load_windows(session, scope, target)
    return cache


async def load_whole_stats(
    session: AsyncSession, scope: ComputeScope, target: RowTarget
) -> dict[str, WholeStats]:
    """全部 `*_ALL` 引用的整列底数，键用引用原文（跨表的形如 `表code.列key`）。

    Args: session, scope, target。
    """
    stats: dict[str, WholeStats] = {}
    by_table: dict[str | None, list[WholeRefKey]] = {}
    for ref in scope.plan.whole_refs:
        by_table.setdefault(ref.table_code, []).append(
            WholeRefKey(reference=ref.key, column=ref.column_key)
        )
    for code, refs in by_table.items():
        table_id = (
            target.table_id if code is None else scope.table_ids.get(code)
        )
        if table_id is None:
            # 编码解析不出来在保存公式时就报过了；走到这里说明取数上下文没带上
            # 映射，给空统计好过打断整批重算
            stats.update({item.reference: WholeStats() for item in refs})
            continue
        stats.update(
            await _stats_of(
                session,
                table_id=table_id,
                refs=refs,
                exclude_row_id=target.exclude_row_id if code is None else None,
            )
        )
    return stats


def fold_current(
    stats: dict[str, WholeStats], values: dict[str, Any] | None
) -> dict[str, WholeStats]:
    """把当前行的值折进整列底数。

    ⚠ 新建或编辑的这一行还不在库里。不折进来的话，当它正好是新的极值时，
    `({值}-MIN_ALL)/(MAX_ALL-MIN_ALL)` 会算出越界的数（§5.6）。
    ⚠ 只折本表的键：带表前缀的那些属于另一张表，当前行不在其中。
    Args: stats, values。
    """
    if values is None:
        return stats
    return {
        key: (
            stats[key].fold(values.get(key)) if "." not in key else stats[key]
        )
        for key in stats
    }


async def load_external_rows(
    session: AsyncSession, scope: ComputeScope, span: RowSpan
) -> dict[str, list[RowSnapshot]]:
    """跨表引用要读的对方表行，按 ts 升序（as-of 二分与窗口切片共用一份）。

    Args: session, scope, span。
    """
    rows: dict[str, list[RowSnapshot]] = {}
    for code in sorted(scope.plan.external_table_codes):
        table_id = scope.table_ids.get(code)
        if table_id is None:
            rows[code] = []
            continue
        rows[code] = await _external_series(
            session, scope, span, table_id, code
        )
    return rows


async def _stats_of(
    session: AsyncSession,
    *,
    table_id: uuid.UUID,
    refs: list[WholeRefKey],
    exclude_row_id: uuid.UUID | None,
) -> dict[str, WholeStats]:
    """一张表上若干列的整列底数。

    ⚠ 查不到的列先按空统计铺底再覆盖：空表上的 `*_ALL` 该算作「没有数据」，
    而不是「这个键不在场」——后者会被求值器判成漏装取数相位。
    Args: session, table_id, refs, exclude_row_id。
    """
    found = await record_crud.whole_stats(
        session,
        table_id=table_id,
        keys=[item.column for item in refs],
        exclude_row_id=exclude_row_id,
    )
    return {item.reference: _to_stats(found.get(item.column)) for item in refs}


def _to_stats(row: WholeStatsRow | None) -> WholeStats:
    """库里的一行底数 → 求值器认得的形态。

    Args: row。
    """
    if row is None:
        return WholeStats()
    return WholeStats(
        minimum=row.minimum,
        maximum=row.maximum,
        total=row.total,
        count=row.count,
    )


async def _load_prev(
    session: AsyncSession, scope: ComputeScope, target: RowTarget
) -> list[RowSnapshot]:
    """`PREV` 要的那几行，按 ts 降序（[0] 即上一行）。

    Args: session, scope, target。
    """
    if scope.max_prev <= 0:
        return []
    rows = await record_crud.list_before(
        session,
        window=RecordWindow(
            table_id=target.table_id,
            before=target.ts,
            exclude_row_id=target.exclude_row_id,
        ),
        limit=scope.max_prev,
    )
    return [to_snapshot(row) for row in rows]


async def _load_windows(
    session: AsyncSession, scope: ComputeScope, target: RowTarget
) -> dict[str, list[RowSnapshot]]:
    """本表的时间窗行：只查最宽的那一个，各窗自己再切。

    ⚠ 每个窗口各发一条区间查询是在重复扫同一段数据；而求值层本来就会按各自的
    下界再切一次，多给几行不会算错。
    Args: session, scope, target。
    """
    specs = scope.local_windows
    if not specs:
        return {}
    lowers = [
        window_lower_bound(target.ts, spec, scope.timezone) for spec in specs
    ]
    rows = await record_crud.list_ascending(
        session,
        window=RecordWindow(
            table_id=target.table_id,
            after=min(lowers),
            until=target.ts,
            exclude_row_id=target.exclude_row_id,
        ),
    )
    widest = [to_snapshot(row) for row in rows]
    return {spec.literal: widest for spec in specs}


async def _external_series(
    session: AsyncSession,
    scope: ComputeScope,
    span: RowSpan,
    table_id: uuid.UUID,
    code: str,
) -> list[RowSnapshot]:
    """一张外部台账在这一批行的算数期间要用到的全部行。

    ⚠ 锚点行单独取一条：直接引用走 as-of（取 ts ≤ 当前行的最后一行），而它
    可能比任何一个窗口的下界都早。少了它，跨表引用在整段区间上一路算空。
    Args: session, scope, span, table_id, code。
    """
    lower = min(
        [
            window_lower_bound(span.start, ref.spec, scope.timezone)
            for ref in scope.external_windows
            if ref.table_code == code
        ]
        + [span.start]
    )
    series = await record_crud.list_ascending(
        session,
        window=RecordWindow(table_id=table_id, since=lower, until=span.end),
    )
    anchor = await record_crud.list_before(
        session,
        window=RecordWindow(table_id=table_id, before=lower),
        limit=1,
    )
    return [to_snapshot(row) for row in [*reversed(anchor), *series]]
