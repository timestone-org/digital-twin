"""条目的三条口径：取不到就说取不到、时刻照实、按键合并。

⚠ 取不到时**不带 value**：带一个 null 会被前端读成「现场报了空值」，而那两件
事的处置完全不同。
⚠ 值有多旧不构成一档状态：订阅只在值变化时回调，一个一天变一次的点位按年龄
判就会每天被误标 23 小时，而它的值一直是对的。
"""

from platform_server.apps.collect.services import PointReading
from platform_server.apps.collect.services.point_frames import (
    KEY_ERROR,
    KEY_NODE,
    KEY_QUALITY,
    KEY_STATE,
    KEY_TIMESTAMP_MS,
    KEY_VALUE,
    MISSING_REASON,
    POINT_STATE_ERROR,
    POINT_STATE_OK,
    POINT_STATES,
    build_items,
    changed_items,
    error_items,
    index_by_node_key,
    shards,
)

SOURCE = "0198f0c0-0000-7000-8000-00000000abcd"
OUTLET = f"{SOURCE}:outlet_temp"
INLET = f"{SOURCE}:inlet_temp"
NOW_MS = 1_760_000_000_000
# 一天。用来验「很久没变的值照样是正常值」
A_DAY_MS = 86_400_000


def reading(
    value: object, *, age_ms: int = 0, quality: str = "good"
) -> PointReading:
    """一条读数，时刻按「比此刻早多少毫秒」给。

    Args: value, age_ms, quality。
    """
    return PointReading(
        value=value, timestamp_ms=NOW_MS - age_ms, quality=quality
    )


def test_a_reading_is_pushed_as_ok_with_its_own_timestamp() -> None:
    items = build_items([OUTLET], {OUTLET: reading(21.5, age_ms=1_000)})
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
    items = build_items([OUTLET], {OUTLET: reading(0)})
    assert items[0][KEY_VALUE] == 0
    assert items[0][KEY_STATE] == POINT_STATE_OK


def test_a_value_that_has_not_changed_all_day_is_still_a_normal_value() -> None:
    # 一天才变一次的点位不许因为「时刻旧」被降档：它的值一直是对的
    items = build_items([OUTLET], {OUTLET: reading(21.5, age_ms=A_DAY_MS)})
    assert items[0][KEY_STATE] == POINT_STATE_OK
    assert items[0][KEY_TIMESTAMP_MS] == NOW_MS - A_DAY_MS


def test_a_point_without_a_snapshot_says_so_and_carries_no_value() -> None:
    items = build_items([OUTLET], {})
    assert items == [
        {
            KEY_NODE: OUTLET,
            KEY_STATE: POINT_STATE_ERROR,
            KEY_ERROR: MISSING_REASON,
        }
    ]


def test_the_items_keep_the_order_of_the_plan() -> None:
    items = build_items([OUTLET, INLET], {})
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
        [OUTLET, INLET], {OUTLET: reading(21.5), INLET: reading(18.0)}
    )
    current = build_items(
        [OUTLET, INLET], {OUTLET: reading(21.5), INLET: reading(19.0)}
    )
    changed = changed_items(current, index_by_node_key(previous))
    assert [item[KEY_NODE] for item in changed] == [INLET]


def test_a_quality_change_alone_is_a_change_worth_pushing() -> None:
    # 值一字没改而质量位变了，正是客户端最需要知道的一次变化
    previous = build_items([OUTLET], {OUTLET: reading(21.5)})
    current = build_items(
        [OUTLET], {OUTLET: reading(21.5, quality="uncertain")}
    )
    changed = changed_items(current, index_by_node_key(previous))
    assert [item[KEY_QUALITY] for item in changed] == ["uncertain"]


def test_a_point_that_lost_its_snapshot_is_pushed_as_a_change() -> None:
    previous = build_items([OUTLET], {OUTLET: reading(21.5)})
    current = build_items([OUTLET], {})
    changed = changed_items(current, index_by_node_key(previous))
    assert [item[KEY_STATE] for item in changed] == [POINT_STATE_ERROR]


def test_nothing_changed_means_nothing_is_pushed() -> None:
    items = build_items([OUTLET], {OUTLET: reading(21.5)})
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
    assert set(POINT_STATES) == {POINT_STATE_ERROR, POINT_STATE_OK}
    assert all(isinstance(state, str) for state in POINT_STATES)
