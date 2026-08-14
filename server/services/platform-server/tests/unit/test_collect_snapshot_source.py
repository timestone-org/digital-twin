"""快照读侧的解码口径：只取要用的字段，缺失与损坏都不冒充读数。

⚠ 「缺失」与「值是 0」必须分得开：补一个零值等于凭空造一条现场读数，而它在
大屏上与真实读数长得一模一样。
"""

import json
import uuid

from platform_server.apps.collect.services.snapshot_source import (
    FIELD_QUALITY,
    FIELD_TIMESTAMP_MS,
    FIELD_VALUE,
    PointReading,
    decode_reading,
    decode_rows,
    group_by_source,
    snapshot_key,
)

SOURCE = uuid.UUID("0198f0c0-0000-7000-8000-00000000abcd")
OTHER_SOURCE = uuid.UUID("0198f0c0-0000-7000-8000-00000000abce")
NOW_MS = 1_760_000_000_000


def encoded(value: object, *, quality: str = "good") -> str:
    """按 collector 的编码造一个哈希字段值。

    Args: value, quality。
    """
    return json.dumps(
        {
            FIELD_VALUE: value,
            FIELD_TIMESTAMP_MS: NOW_MS,
            FIELD_QUALITY: quality,
        }
    )


def test_the_snapshot_key_is_one_hash_per_source() -> None:
    assert snapshot_key(SOURCE) == f"collect:snapshot:{SOURCE}"


def test_points_are_grouped_by_the_source_that_owns_them() -> None:
    grouped = group_by_source(
        [
            f"{SOURCE}:outlet_temp",
            f"{SOURCE}:inlet_temp",
            f"{OTHER_SOURCE}:run_state",
        ]
    )
    assert grouped == {
        SOURCE: ("inlet_temp", "outlet_temp"),
        OTHER_SOURCE: ("run_state",),
    }


def test_a_point_asked_for_twice_is_read_once() -> None:
    grouped = group_by_source([f"{SOURCE}:outlet_temp"] * 3)
    assert grouped == {SOURCE: ("outlet_temp",)}


def test_a_malformed_identity_is_dropped_instead_of_failing_the_batch() -> None:
    grouped = group_by_source(["no-separator", f"{SOURCE}:outlet_temp"])
    assert grouped == {SOURCE: ("outlet_temp",)}


def test_a_field_decodes_into_the_reading_collector_wrote() -> None:
    assert decode_reading(encoded(21.5)) == PointReading(
        value=21.5, timestamp_ms=NOW_MS, quality="good"
    )


def test_a_zero_reading_survives_decoding() -> None:
    reading = decode_reading(encoded(0))
    assert reading is not None
    assert reading.value == 0


def test_a_missing_field_is_absence_not_a_null_reading() -> None:
    assert decode_reading(None) is None


def test_a_corrupt_field_is_absence_not_a_null_reading() -> None:
    assert decode_reading("{not json") is None


def test_a_field_without_a_sampling_time_is_refused() -> None:
    # 没有时刻就判不了陈旧，而「不知道多旧」不许当成「刚采到」
    assert decode_reading(json.dumps({FIELD_VALUE: 1})) is None


def test_a_field_that_is_not_an_object_is_refused() -> None:
    assert decode_reading(json.dumps([1, 2])) is None


def test_an_unknown_quality_falls_back_to_bad() -> None:
    # 质量位判不出来却当好数据用，会污染下游
    reading = decode_reading(encoded(1, quality="weird"))
    assert reading is not None
    assert reading.quality == "bad"


def test_the_rows_map_back_to_the_identities_that_were_asked_for() -> None:
    grouped = {SOURCE: ("inlet_temp", "outlet_temp")}
    readings = decode_rows(grouped, [[encoded(18.0), encoded(21.5)]])
    assert set(readings) == {
        f"{SOURCE}:inlet_temp",
        f"{SOURCE}:outlet_temp",
    }
    assert readings[f"{SOURCE}:outlet_temp"].value == 21.5


def test_a_source_whose_hash_expired_yields_no_readings() -> None:
    # 采集进程死掉后快照跟着过期，大屏于是拿不到值而不是拿着旧值当实时值
    grouped = {SOURCE: ("outlet_temp",)}
    assert decode_rows(grouped, [[None]]) == {}
