"""条目的三条口径：取不到就说取不到、陈旧标注为陈旧、按键合并。

⚠ 取不到时**不带 value**：带一个 null 会被前端读成「现场报了空值」，而那两件
事的处置完全不同。
"""

from platform_server.apps.collect.services import PointReading
from platform_server.apps.dashboard.services.publish_items import (
    KEY_ERROR,
    KEY_NODE,
    KEY_QUALITY,
    KEY_STATE,
    KEY_TIMESTAMP_MS,
    KEY_VALUE,
    MISSING_REASON,
    POINT_STATE_ERROR,
    POINT_STATE_OK,
    POINT_STATE_STALE,
    POINT_STATES,
    build_items,
    changed_items,
    error_items,
    index_by_node_key,
    now_ms,
    shards,
)

SOURCE = "0198f0c0-0000-7000-8000-00000000abcd"
OUTLET = f"{SOURCE}:outlet_temp"
INLET = f"{SOURCE}:inlet_temp"
NOW_MS = 1_760_000_000_000
STALE_AFTER_MS = 15_000


def reading(value: object, *, age_ms: int = 0) -> PointReading:
    """一条读数，时刻按「比本拍早多少毫秒」给。

    Args: value, age_ms。
    """
    return PointReading(
        value=value, timestamp_ms=NOW_MS - age_ms, quality="good"
    )


def test_a_fresh_reading_is_pushed_as_ok_with_its_own_timestamp() -> None:
    items = build_items(
        [OUTLET],
        {OUTLET: reading(21.5, age_ms=1_000)},
        at_ms=NOW_MS,
        stale_after_ms=STALE_AFTER_MS,
    )
    assert items == [
        {
            KEY_NODE: OUTLET,
            KEY_STATE: POINT_STATE_OK,
            KEY_VALUE: 21.5,
            KEY_TIMESTAMP_MS: NOW_MS - 1_000,
            KEY_QUALITY: "good",
        }
    ]


def test_a_zero_reading_is_a_reading_and_not_an_absence() -> None:
    items = build_items(
        [OUTLET],
        {OUTLET: reading(0)},
        at_ms=NOW_MS,
        stale_after_ms=STALE_AFTER_MS,
    )
    assert items[0][KEY_VALUE] == 0
    assert items[0][KEY_STATE] == POINT_STATE_OK


def test_an_old_reading_is_marked_stale_and_keeps_the_old_timestamp() -> None:
    items = build_items(
        [OUTLET],
        {OUTLET: reading(21.5, age_ms=STALE_AFTER_MS + 1)},
        at_ms=NOW_MS,
        stale_after_ms=STALE_AFTER_MS,
    )
    assert items[0][KEY_STATE] == POINT_STATE_STALE
    assert items[0][KEY_TIMESTAMP_MS] == NOW_MS - STALE_AFTER_MS - 1


def test_a_point_without_a_snapshot_says_so_and_carries_no_value() -> None:
    items = build_items(
        [OUTLET], {}, at_ms=NOW_MS, stale_after_ms=STALE_AFTER_MS
    )
    assert items == [
        {
            KEY_NODE: OUTLET,
            KEY_STATE: POINT_STATE_ERROR,
            KEY_ERROR: MISSING_REASON,
        }
    ]


def test_the_items_keep_the_order_of_the_plan() -> None:
    items = build_items(
        [OUTLET, INLET], {}, at_ms=NOW_MS, stale_after_ms=STALE_AFTER_MS
    )
    assert [item[KEY_NODE] for item in items] == [OUTLET, INLET]


def test_a_read_failure_marks_the_whole_batch_as_unreadable() -> None:
    items = error_items([OUTLET, INLET], reason="读不到")
    assert [item[KEY_STATE] for item in items] == [
        POINT_STATE_ERROR,
        POINT_STATE_ERROR,
    ]
    assert all(KEY_VALUE not in item for item in items)


def test_only_the_entries_that_differ_from_the_last_push_go_out() -> None:
    previous = build_items(
        [OUTLET, INLET],
        {OUTLET: reading(21.5), INLET: reading(18.0)},
        at_ms=NOW_MS,
        stale_after_ms=STALE_AFTER_MS,
    )
    current = build_items(
        [OUTLET, INLET],
        {OUTLET: reading(21.5), INLET: reading(19.0)},
        at_ms=NOW_MS,
        stale_after_ms=STALE_AFTER_MS,
    )
    changed = changed_items(current, index_by_node_key(previous))
    assert [item[KEY_NODE] for item in changed] == [INLET]


def test_a_state_change_alone_is_a_change_worth_pushing() -> None:
    sample = reading(21.5, age_ms=STALE_AFTER_MS + 1)
    previous = build_items(
        [OUTLET], {OUTLET: sample}, at_ms=NOW_MS, stale_after_ms=999_999
    )
    current = build_items(
        [OUTLET], {OUTLET: sample}, at_ms=NOW_MS, stale_after_ms=STALE_AFTER_MS
    )
    changed = changed_items(current, index_by_node_key(previous))
    assert [item[KEY_STATE] for item in changed] == [POINT_STATE_STALE]


def test_nothing_changed_means_nothing_is_pushed() -> None:
    items = build_items(
        [OUTLET],
        {OUTLET: reading(21.5)},
        at_ms=NOW_MS,
        stale_after_ms=STALE_AFTER_MS,
    )
    assert changed_items(items, index_by_node_key(items)) == []


def test_a_batch_over_the_ceiling_is_cut_by_the_sender() -> None:
    items = error_items(
        [f"{SOURCE}:point{index}" for index in range(5)], reason="x"
    )
    assert [len(shard) for shard in shards(items, 2)] == [2, 2, 1]


def test_a_batch_within_the_ceiling_stays_in_one_piece() -> None:
    items = error_items([OUTLET, INLET], reason="x")
    assert shards(items, 2) == [items]


def test_the_states_are_a_closed_set_of_strings() -> None:
    # ⚠ 数字枚举在两个仓之间对不上号时没有任何提示（api-contract §4.2）
    assert set(POINT_STATES) == {
        POINT_STATE_ERROR,
        POINT_STATE_OK,
        POINT_STATE_STALE,
    }
    assert all(isinstance(state, str) for state in POINT_STATES)


def test_the_clock_reads_milliseconds_since_the_epoch() -> None:
    # 2026 年的毫秒时刻已经是 13 位数；写成秒会让每个值都「刚采到」
    assert now_ms() > 1_700_000_000_000
