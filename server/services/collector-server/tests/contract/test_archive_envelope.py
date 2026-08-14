"""守归档管道的三份隐式约定：流键、条目信封与宽表的列口径。

⚠ 这三份都是「改了不报错、只静默出错」的约定：键名分叉会让落库端永远扫不到
那条流，信封漏 traceparent 会让链路在异步处齐断，列名与 domain 分叉则会让写
侧与读侧各说各话（COLLECT_DESIGN.md §3 与 §6）。
"""

import json
from uuid import UUID

from collector_server.apps.collect.archive.buffer import ArchiveRow
from collector_server.apps.collect.archive.writer import to_row
from collector_server.apps.collect.crud.point_history import (
    ASYNCPG_MAX_BIND_PARAMS,
    MAX_INSERT_ROWS,
)
from collector_server.apps.collect.models.point_history import PointHistory
from collector_server.commands import TRACEPARENT_KEY
from collector_server.stream import (
    KEY_PREFIX,
    ROWS_FIELD,
    envelope_with_traceparent,
    source_of,
    stream_key,
)
from timeseries import (
    CHUNK_INTERVAL,
    HISTORY_COLUMNS,
    HISTORY_SCHEMA,
    HISTORY_TABLE,
    PRIMARY_KEY_COLUMNS,
    SEGMENT_BY,
    read_value,
)

SOURCE_ID = UUID("0192f000-0000-7000-8000-000000000001")
TS_MS = 1_767_323_045_000
CHUNK_INTERVAL_HOURS = 6


def test_the_archive_stream_key_is_namespaced_by_the_owning_context() -> None:
    assert stream_key(SOURCE_ID) == f"{KEY_PREFIX}:{SOURCE_ID}"


def test_the_source_is_recoverable_from_the_stream_key() -> None:
    assert source_of(stream_key(SOURCE_ID)) == SOURCE_ID


def test_a_key_from_another_face_is_not_mistaken_for_a_stream() -> None:
    assert source_of(f"collect:snapshot:{SOURCE_ID}") is None


def test_a_stream_key_with_a_broken_source_is_refused() -> None:
    assert source_of(f"{KEY_PREFIX}:not-a-uuid") is None


def test_the_entry_envelope_carries_the_trace() -> None:
    envelope = envelope_with_traceparent([{"point_code": "outlet_temp"}])
    assert TRACEPARENT_KEY in envelope


def test_the_entry_envelope_keeps_the_rows_under_one_field() -> None:
    envelope = envelope_with_traceparent([{"point_code": "outlet_temp"}])
    assert json.loads(envelope[ROWS_FIELD]) == [{"point_code": "outlet_temp"}]


def test_a_buffered_row_survives_the_trip_through_the_stream() -> None:
    row = ArchiveRow(
        point_code="outlet_temp", value=21.5, ts_ms=TS_MS, quality="uncertain"
    )
    envelope = envelope_with_traceparent([row.to_payload()])
    stored = to_row(SOURCE_ID, json.loads(envelope[ROWS_FIELD])[0])
    assert stored is not None
    assert (
        stored["point_code"],
        read_value(stored["value_num"], stored["value_text"]),
        stored["quality"],
    ) == ("outlet_temp", 21.5, "uncertain")


def test_the_stored_row_fills_exactly_the_columns_domain_declares() -> None:
    row = to_row(
        SOURCE_ID,
        ArchiveRow(
            point_code="outlet_temp", value=1, ts_ms=TS_MS, quality="good"
        ).to_payload(),
    )
    assert row is not None
    assert tuple(row) == HISTORY_COLUMNS


def test_the_table_is_the_one_domain_names() -> None:
    assert (
        PointHistory.__table__.schema,
        PointHistory.__table__.name,
    ) == (HISTORY_SCHEMA, HISTORY_TABLE)


def test_the_model_declares_exactly_the_domain_columns() -> None:
    assert tuple(PointHistory.__table__.columns.keys()) == HISTORY_COLUMNS


def test_the_primary_key_is_the_natural_composite_key() -> None:
    columns = PointHistory.__table__.primary_key.columns
    assert tuple(columns.keys()) == PRIMARY_KEY_COLUMNS


def test_the_segment_key_keeps_the_point_code() -> None:
    assert SEGMENT_BY == ("source_id", "point_code")


def test_the_chunk_interval_is_six_hours() -> None:
    assert CHUNK_INTERVAL.total_seconds() == CHUNK_INTERVAL_HOURS * 3600


def test_the_archive_table_has_no_protocol_column() -> None:
    assert "protocol" not in PointHistory.__table__.columns


def test_one_insert_never_outruns_the_driver_parameter_limit() -> None:
    assert MAX_INSERT_ROWS * len(HISTORY_COLUMNS) <= ASYNCPG_MAX_BIND_PARAMS
