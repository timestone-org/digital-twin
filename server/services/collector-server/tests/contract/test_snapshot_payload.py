"""守快照的跨服务契约：键名、字段名与载荷形状。

collector 写、`platform-publisher` 读（DASHBOARD_DESIGN.md §6）。改这里等于改
一个已经上线的口径，必须先改这份契约。
"""

import json
from uuid import UUID

from collector_server.apps.collect.runtime.sink import encode_fields
from collector_server.snapshot import KEY_PREFIX, snapshot_key

SOURCE_ID = UUID("0192f000-0000-7000-8000-000000000001")
TS_MS = 1_767_323_045_000


def test_snapshot_key_is_one_hash_per_source() -> None:
    assert (
        snapshot_key(SOURCE_ID)
        == "collect:snapshot:0192f000-0000-7000-8000-000000000001"
    )


def test_key_prefix_is_namespaced_by_the_owning_context() -> None:
    assert KEY_PREFIX == "collect:snapshot"


def test_field_name_is_the_point_code() -> None:
    encoded = encode_fields({"outlet_temp": (21.5, TS_MS, "good")})
    assert list(encoded) == ["outlet_temp"]


def test_payload_has_exactly_three_keys() -> None:
    encoded = encode_fields({"outlet_temp": (21.5, TS_MS, "good")})
    assert json.loads(encoded["outlet_temp"]) == {
        "value": 21.5,
        "ts_ms": TS_MS,
        "quality": "good",
    }


def test_boolean_and_text_readings_survive_the_round_trip() -> None:
    encoded = encode_fields(
        {
            "running": (True, TS_MS, "good"),
            "mode": ("auto", TS_MS, "uncertain"),
            "gone": (None, TS_MS, "bad"),
        }
    )
    assert [json.loads(encoded[name])["value"] for name in encoded] == [
        True,
        "auto",
        None,
    ]


def test_quality_is_one_of_the_three_protocol_independent_grades() -> None:
    encoded = encode_fields({"a": (1, TS_MS, "uncertain")})
    assert json.loads(encoded["a"])["quality"] in {"good", "uncertain", "bad"}
