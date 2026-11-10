"""窗口聚合在整表重算里必须是线性的：每行每列只读一次，切窗走二分。

⚠ 重算一趟里窗口历史是同一串只追加的行。每行都把整串窗口重新转一遍数，
1 分钟台账的「今日」窗就是每行 1440 次，整表几千行、几十个窗口引用就是上亿次
——现象是重算卡上一分多钟、把同进程的其他请求一并拖到语句超时。
"""

from datetime import UTC, datetime, timedelta

import pytest

from platform_server.apps.dataset.formula import (
    HistoryCache,
    RowSnapshot,
    build_externals,
    parse_formula,
)

START = datetime(2026, 11, 9, 0, 0, tzinfo=UTC)
ROWS = 400
FUNCS = (
    "SUM_OVER",
    "AVG_OVER",
    "MIN_OVER",
    "MAX_OVER",
    "COUNT_OVER",
    "FIRST_OVER",
    "LAST_OVER",
    "ALL_ZERO_OVER",
)
# 空、脏串、数字串、零、负数都要有：跳过与计数的口径全靠它们区分
CELLS: tuple[object, ...] = (
    None,
    "坏值",
    "1.5",
    0,
    0.0,
    -2,
    3.25,
    7,
    "",
    1e300,
)


def minutes(count: int) -> datetime:
    """起点之后若干分钟。Args: count。"""
    return START + timedelta(minutes=count)


def window_values(
    source: str, rows: list[RowSnapshot], *, shared: HistoryCache | None
) -> list[object]:
    """按重算的走法逐行求一个窗口引用：历史只追加，当前行算完再并入。

    Args: source, rows, shared（给就整趟共用一份缓存，不给就每行新造）。
    """
    parsed = parse_formula(source)
    (window,) = parsed.deps.window
    key = ("win", window.func, window.key, window.spec.literal)
    series: list[RowSnapshot] = []
    results: list[object] = []
    for current in rows:
        cache = shared or HistoryCache(tz=UTC)
        cache.window_rows = {window.spec.literal: series}
        results.append(build_externals(parsed.deps, cache, current)[key])
        series.append(current)
    return results


def test_a_shared_cache_reads_each_cell_once_not_once_per_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [
        RowSnapshot(ts=minutes(i), values={"a": float(i)}) for i in range(ROWS)
    ]
    reads = 0
    original = RowSnapshot.get

    def counted(self: RowSnapshot, key: str) -> object:
        nonlocal reads
        reads += 1
        return original(self, key)

    monkeypatch.setattr(RowSnapshot, "get", counted)

    window_values("SUM_OVER({a}, 'today')", rows, shared=HistoryCache(tz=UTC))

    # 线性：每行入索引一次 + 当前行判在场一次。平方级是 ROWS² / 2 ≈ 八万次
    assert reads <= 4 * ROWS


@pytest.mark.parametrize("func", FUNCS)
def test_the_shared_index_agrees_with_one_built_from_scratch(func: str) -> None:
    # 确定性的打散：步长与列表长互素，每种格值都会落在窗口的各个位置；一部分
    # 行落在同一分钟上，今日窗的午夜下界也会被跨过一次
    offset = FUNCS.index(func)
    rows = [
        RowSnapshot(
            ts=minutes((i * 37 + offset) % 1500),
            values={"a": CELLS[(i * 7 + offset) % len(CELLS)]},
        )
        for i in range(ROWS)
    ]
    rows.sort(key=lambda row: row.ts)
    source = f"{func}({{a}}, 'today')"

    shared = window_values(source, rows, shared=HistoryCache(tz=UTC))
    fresh = window_values(source, rows, shared=None)

    assert shared == fresh


def test_a_reused_cache_rebuilds_when_handed_a_different_series() -> None:
    # ⚠ 索引按行序列的身份记账：换了一串行（多趟重算每趟都是新的一串）还拿
    # 旧账就是把上一趟的数算进这一趟
    cache = HistoryCache(tz=UTC)
    parsed = parse_formula("SUM_OVER({a}, 'today')")
    key = ("win", "SUM_OVER", "a", "today")
    current = RowSnapshot(ts=minutes(10), values={})

    cache.window_rows = {"today": [RowSnapshot(ts=minutes(1), values={"a": 1})]}
    first = build_externals(parsed.deps, cache, current)[key]
    cache.window_rows = {"today": [RowSnapshot(ts=minutes(1), values={"a": 5})]}
    second = build_externals(parsed.deps, cache, current)[key]

    assert (first, second) == (1.0, 5.0)
