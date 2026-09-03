"""公式列的求值：编计划、算一行、按区间重算。

⚠ 长循环必须主动让出事件循环：几万行连算会把同进程的 `/health`、其余 API 与
WS 心跳一起阻塞几十秒。⚠ 不用 `asyncio.to_thread`——线程里改 ORM 实例会碰
SQLAlchemy 的线程安全边界。
"""

import asyncio
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import datetime, tzinfo
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from platform_server.apps.dataset.crud import (
    RecordWindow,
    record_crud,
    table_crud,
)
from platform_server.apps.dataset.formula import (
    AnalysisModel,
    AnalysisUnavailable,
    BatchAnalysisModel,
    ColumnFormula,
    EvalContext,
    FormulaError,
    HistoryCache,
    ModelMemo,
    PredictKey,
    RowSnapshot,
    WholeStats,
    build_externals,
    build_plan,
    evaluate,
    window_lower_bound,
)
from platform_server.apps.dataset.models import DatasetColumn, DatasetRecord
from platform_server.apps.dataset.services.effective import (
    effective_values,
    to_snapshot,
)
from platform_server.apps.dataset.services.formula_library import library_for
from platform_server.apps.dataset.services.record_history import (
    ComputeScope,
    RowSpan,
    RowTarget,
    fold_current,
    load_external_rows,
    load_history,
    load_models,
    load_whole_stats,
)

_logger = get_logger("platform.dataset.compute")

# 一次重算最多改写多少行。触顶时如实上报，不静默截断
MAX_RECOMPUTE_ROWS = 200_000
# 每处理这么多行让出一次事件循环。⚠ 不用 `asyncio.to_thread`——线程里改
# ORM 实例会碰 SQLAlchemy 的线程安全边界
YIELD_EVERY = 500
# `*_ALL` 指向公式列时要多跑几趟才收敛，上限就这么多
_MAX_PASSES = 3


@dataclass(frozen=True)
class RecomputeOutcome:
    """一次区间重算的结果。"""

    recomputed: int
    failed: int
    is_truncated: bool
    limit: int


async def build_scope(
    session: AsyncSession,
    *,
    columns: Sequence[DatasetColumn],
    timezone: tzinfo,
) -> ComputeScope:
    """编一份求值计划。

    ⚠ 编不过的**单列**不让整表编译失败：它们各记一条原因落到那一格的
    `compute_error` 上（`ComputePlan.failures`）。真正会抛的只有环。
    Args: session, columns, timezone。
    """
    known_keys = {column.key for column in columns}
    entries = [
        ColumnFormula(key=column.key, name=column.name, formula=column.formula)
        for column in columns
        if column.source == "formula" and column.formula
    ]
    plan = build_plan(
        sorted(entries, key=lambda item: item.key),
        known_keys,
        known_tables=await table_crud.all_codes(session),
        library=await library_for(session, columns),
    )
    return ComputeScope(
        plan=plan,
        table_ids=await table_crud.code_to_id(session),
        timezone=timezone,
    )


def evaluate_row(
    scope: ComputeScope,
    ts: datetime,
    values: dict[str, Any],
    cache: HistoryCache,
) -> tuple[dict[str, Any], dict[str, str]]:
    """按拓扑序算完一行的全部公式列（纯同步）。

    ⚠ 某一列求值抛错只记进 `errors` 并把那一格置空，别的列照常出数：一条写坏
    的公式不该让整行——乃至整批重算——失败。
    Args: scope, ts, values（须是 effective 值）, cache。
    """
    computed: dict[str, Any] = {}
    errors: dict[str, str] = dict(scope.plan.failures)
    for key in scope.plan.order:
        merged = {**values, **computed}
        current = RowSnapshot(ts=ts, values=merged)
        parsed = scope.plan.parsed[key]
        try:
            externals = build_externals(parsed.deps, cache, current)
            computed[key] = evaluate(
                parsed,
                EvalContext(
                    values=merged,
                    externals=externals,
                    row_ts=ts,
                    model_memo=cache.model_memo,
                ),
            )
        except FormulaError as error:
            computed[key] = None
            errors[key] = str(error)
    return computed, errors


async def compute_row(
    session: AsyncSession, scope: ComputeScope, target: RowTarget
) -> tuple[dict[str, Any], dict[str, str]]:
    """算一行：取历史 → 求值。

    Args: session, scope, target（`current_values` 须是 effective 值——与历史
        邻居走同一套取值口径，否则同一列会在「本行」与「PREV 里的本行」取到
        两个不同的数）。
    """
    if scope.plan.is_empty:
        return {}, {}
    values = target.current_values or {}
    if not _needs_extra_passes(scope):
        cache = await load_history(session, scope, target)
        return evaluate_row(scope, target.ts, values, cache)
    # 要迭代时先拿**未折算**的库内底数，折算改由下面每趟自己做，否则本行的值
    # 会被折进去两次
    cache = await load_history(
        session, scope, replace(target, current_values=None)
    )
    base = dict(cache.whole_stats)
    computed: dict[str, Any] = {}
    errors: dict[str, str] = {}
    for _ in range(_MAX_PASSES):
        cache.whole_stats = fold_current(base, {**values, **computed})
        following, following_errors = evaluate_row(
            scope, target.ts, values, cache
        )
        if following == computed:
            break
        computed, errors = following, following_errors
    return computed, errors


async def recompute_range(
    session: AsyncSession,
    scope: ComputeScope,
    *,
    table_id: uuid.UUID,
    window: RecordWindow,
) -> RecomputeOutcome:
    """重算区间内每一行的公式列，只写 `computed_json` 与 `compute_error`。

    ⚠ 触顶判定多查一行，不拿 `len(rows) == limit` 猜：恰好只有上限那么多行时
    数据其实是完整的，猜法会把它误报成截断（§6.2）。
    Args: session, scope, table_id, window。
    """
    if scope.plan.is_empty:
        return RecomputeOutcome(0, 0, False, MAX_RECOMPUTE_ROWS)
    fetched = await record_crud.scan_oldest(
        session, window=window, limit=MAX_RECOMPUTE_ROWS
    )
    is_truncated = len(fetched) > MAX_RECOMPUTE_ROWS
    targets = fetched[:MAX_RECOMPUTE_ROWS]
    if not targets:
        return RecomputeOutcome(0, 0, is_truncated, MAX_RECOMPUTE_ROWS)
    failed = await _run_passes(session, scope, table_id, targets)
    return RecomputeOutcome(
        recomputed=len(targets),
        failed=failed,
        is_truncated=is_truncated,
        limit=MAX_RECOMPUTE_ROWS,
    )


async def _run_passes(
    session: AsyncSession,
    scope: ComputeScope,
    table_id: uuid.UUID,
    targets: list[DatasetRecord],
) -> int:
    """跑到收敛为止，返回出现求值错误的行数。

    Args: session, scope, table_id, targets（按 ts 升序）。
    """
    span = RowSpan(table_id=table_id, start=targets[0].ts, end=targets[-1].ts)
    batch = _Batch(
        # 重算只写计算值，故 effective 值在整趟里不变，整批取一次
        values=[effective_values(record) for record in targets],
        seeds=await _seed_rows(session, scope, table_id, span.start),
        externals=await load_external_rows(session, scope, span),
        # ⚠ 模型定义整批装一次：漏了这一处的症状是「单行试算对、全表重算全空」
        models=await load_models(session, scope),
    )
    await _collect_predictions(session, scope, targets, batch)
    failed = 0
    for _ in range(_MAX_PASSES if _needs_extra_passes(scope) else 1):
        failed, has_changed = await _one_pass(session, scope, targets, batch)
        if not has_changed:
            break
    return failed


async def _collect_predictions(
    session: AsyncSession,
    scope: ComputeScope,
    targets: list[DatasetRecord],
    batch: "_Batch",
) -> None:
    """批量相位：先空跑一遍收齐全部 `PREDICT` 调用，一次算完存进备忘。

    ⚠ 只在**真划算**时跑：树模型那一类逐行调等于逐行付一次到 C 的往返，几万行
    要几十秒；纯 JSON 那些一行就是几个乘加，为它多走一趟收集反而是净亏。
    ⚠ 收集这一趟**不写记录**：它算出来的那些 None 是占位，落库就成了「重算一次
    先把整列清空」。
    ⚠ 收不齐不影响正确性：真实相位里命不中备忘的照样逐行现算（D11b）。
    Args: session, scope, targets, batch。
    """
    batched = [
        model
        for model in batch.models.values()
        if isinstance(model, BatchAnalysisModel) and model.should_batch
    ]
    if not batched:
        return
    memo = ModelMemo()
    batch.memo = memo
    await _one_pass(session, scope, targets, batch)
    _answer(memo, batch.models)
    memo.is_collecting = False


def _answer(
    memo: ModelMemo, models: dict[str, AnalysisModel | AnalysisUnavailable]
) -> None:
    """把收集到的调用按模型分组，一个模型一次算完。

    ⚠ 分组的键是**公式标识**：两条绑定可以指着同一个模型版本，但它们的实参
    映射未必一样，混在一起算就是把甲的实参喂给乙。
    Args: memo, models。
    """
    by_code: dict[str, list[PredictKey]] = {}
    for key in memo.requests:
        by_code.setdefault(key[0], []).append(key)
    memo.requests = []
    for code, keys in by_code.items():
        model = models.get(code)
        if not isinstance(model, BatchAnalysisModel):
            continue
        answers = model.predict_many([(list(key[1]), key[2]) for key in keys])
        for key, answer in zip(keys, answers, strict=True):
            memo.values[key] = answer


@dataclass
class _Batch:
    """一趟重算里对每一行都相同的那几份输入。"""

    values: list[dict[str, Any]]
    seeds: list[RowSnapshot]
    externals: dict[str, list[RowSnapshot]]
    #: 这一批共用的模型定义。⚠ 整批装一次：漏了这一处的症状是「单行试算对、
    #: 全表重算全空」（docs/MODELING_DESIGN.md §7.2）
    models: dict[str, AnalysisModel | AnalysisUnavailable]
    #: 这一批共用的 `PREDICT` 备忘；没开批量相位时是 `None`
    memo: ModelMemo | None = None


async def _one_pass(
    session: AsyncSession,
    scope: ComputeScope,
    targets: list[DatasetRecord],
    batch: _Batch,
) -> tuple[int, bool]:
    """跑一遍全部目标行，返回 (出错行数, 有没有值变过)。

    Args: session, scope, targets, batch。
    """
    whole = await load_whole_stats(
        session,
        scope,
        RowTarget(table_id=targets[0].table_id, ts=targets[0].ts),
    )
    series = list(batch.seeds)
    is_collecting = batch.memo is not None and batch.memo.is_collecting
    failed = 0
    has_changed = False
    for position, record in enumerate(targets):
        values = batch.values[position]
        cache = _cache_of(scope, series, whole, batch)
        computed, errors = evaluate_row(scope, record.ts, values, cache)
        if not is_collecting:
            has_changed = has_changed or computed != (
                record.computed_json or {}
            )
            record.computed_json = computed
            record.compute_error = errors or None
            failed += 1 if errors else 0
        series.append(RowSnapshot(ts=record.ts, values={**values, **computed}))
        # ⚠ 纯内存的长循环要主动让出：几万行连算会把同进程的 /health 一起卡住
        if (position + 1) % YIELD_EVERY == 0:
            await asyncio.sleep(0)
    return failed, has_changed


def _cache_of(
    scope: ComputeScope,
    series: list[RowSnapshot],
    whole: dict[str, WholeStats],
    batch: "_Batch",
) -> HistoryCache:
    """从内存里那串已算过的行切出下一行要用的历史。

    ⚠ 窗口不在这里精确切：求值层会按各自的下界再切一次，多给几行不会算错，
    而少给一行会静默少算（`formula.context._window_value`）。
    Args: scope, series, whole, batch。
    """
    externals = batch.externals
    models = batch.models
    cache = HistoryCache(tz=scope.timezone)
    if scope.max_prev > 0:
        cache.prev_rows = list(reversed(series[-scope.max_prev :]))
    cache.window_rows = {spec.literal: series for spec in scope.local_windows}
    cache.whole_stats = whole
    cache.external_rows = externals
    cache.models = models
    cache.model_memo = batch.memo
    return cache


async def _seed_rows(
    session: AsyncSession,
    scope: ComputeScope,
    table_id: uuid.UUID,
    start: datetime,
) -> list[RowSnapshot]:
    """区间之前的种子行：够 `PREV` 回溯、也够最宽的窗口覆盖。

    ⚠ 少了它，区间里最早那几行的 `PREV` 与时间窗会算成空——而它们在库里明明
    有上文，只是这一趟没取进来。
    Args: session, scope, table_id, start。
    """
    lowers = [
        window_lower_bound(start, spec, scope.timezone)
        for spec in scope.local_windows
    ]
    if lowers:
        rows = await record_crud.list_ascending(
            session,
            window=RecordWindow(
                table_id=table_id, since=min(lowers), before=start
            ),
        )
        return [to_snapshot(row) for row in rows]
    if scope.max_prev <= 0:
        return []
    rows = await record_crud.list_before(
        session,
        window=RecordWindow(table_id=table_id, before=start),
        limit=scope.max_prev,
    )
    return [to_snapshot(row) for row in reversed(rows)]


def _needs_extra_passes(scope: ComputeScope) -> bool:
    """存不存在「`*_ALL` 指向另一个公式列」这种要多趟才收敛的引用。

    Args: scope。
    """
    return any(ref.key in scope.plan.parsed for ref in scope.plan.whole_refs)


def log_recompute(table_id: uuid.UUID, outcome: RecomputeOutcome) -> None:
    """把一次重算的规模记下来。

    Args: table_id, outcome。
    """
    _logger.info(
        "dataset_records_recomputed",
        "台账公式列已重算",
        table_id=str(table_id),
        recomputed=outcome.recomputed,
        failed=outcome.failed,
        is_truncated=outcome.is_truncated,
    )
