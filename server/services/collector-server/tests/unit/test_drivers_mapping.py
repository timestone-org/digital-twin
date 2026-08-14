"""守 OPC UA 的三条协议特有决断：质量位归档、时刻取舍、异常分类。

这些决断只允许发生在驱动内部（ADR-0011），改了它们管道侧看不出来。
"""

from datetime import UTC, datetime

import pytest
from asyncua import ua
from asyncua.ua.uaerrors import (
    BadNodeIdUnknown,
    BadUserAccessDenied,
    UaStringParsingError,
)

from collector_server.apps.collect.drivers.opcua import mapping

FALLBACK_MS = 1_700_000_000_000
# 2026-01-02T03:04:05Z 的 UTC 毫秒
MOMENT_MS = 1_767_323_045_000


def test_good_status_maps_to_good() -> None:
    assert mapping.quality_of(ua.StatusCode(0)) == "good"


def test_uncertain_severity_maps_to_uncertain() -> None:
    assert mapping.quality_of(ua.StatusCode(0x40000000)) == "uncertain"


def test_bad_severity_maps_to_bad() -> None:
    assert mapping.quality_of(ua.StatusCode(0x80000000)) == "bad"


def test_missing_status_maps_to_bad() -> None:
    assert mapping.quality_of(None) == "bad"


def test_source_timestamp_wins_over_server_timestamp() -> None:
    value = ua.DataValue(
        Value=ua.Variant(1.0),
        SourceTimestamp=datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC),
        ServerTimestamp=datetime(2026, 1, 2, 3, 9, 5, tzinfo=UTC),
    )
    assert mapping.timestamp_ms_of(value, fallback_ms=FALLBACK_MS) == MOMENT_MS


def test_server_timestamp_is_used_when_source_is_absent() -> None:
    value = ua.DataValue(
        Value=ua.Variant(1.0),
        ServerTimestamp=datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC),
    )
    assert mapping.timestamp_ms_of(value, fallback_ms=FALLBACK_MS) == MOMENT_MS


def test_naive_timestamp_is_read_as_utc() -> None:
    # 无时区的时刻正是这条用例要验的输入
    naive = datetime(2026, 1, 2, 3, 4, 5)  # noqa: DTZ001
    value = ua.DataValue(Value=ua.Variant(1.0), SourceTimestamp=naive)
    assert mapping.timestamp_ms_of(value, fallback_ms=FALLBACK_MS) == MOMENT_MS


def test_fallback_is_used_when_both_timestamps_are_absent() -> None:
    value = ua.DataValue(Value=ua.Variant(1.0))
    assert (
        mapping.timestamp_ms_of(value, fallback_ms=FALLBACK_MS) == FALLBACK_MS
    )


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (BadUserAccessDenied(), "auth"),
        (BadNodeIdUnknown(), "config"),
        (UaStringParsingError("坏串"), "config"),
        (ConnectionResetError(), "transient"),
        (TimeoutError(), "transient"),
        (RuntimeError("谁知道"), "transient"),
    ],
    ids=["auth", "unknown-node", "bad-address", "reset", "timeout", "unknown"],
)
def test_error_category(error: Exception, expected: str) -> None:
    assert mapping.category_of(error) == expected


def test_address_is_parsed_into_a_node_id() -> None:
    node_id = mapping.node_id_of("ns=2;s=Temp1")
    assert node_id.to_string() == "ns=2;s=Temp1"


def test_malformed_address_raises_instead_of_yielding_a_wrong_node() -> None:
    with pytest.raises(ua.UaError):
        mapping.node_id_of("这不是寻址串")
