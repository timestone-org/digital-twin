"""守快照的编码：字段名是点位编码，值是那三项组成的 JSON。

collector 写、`platform-publisher` 读（DASHBOARD_DESIGN.md §6）。键名与字段名
本身的取值由 `collectwire` 的契约用例守，这里守的是编码这一步。
"""

import json
from uuid import UUID

from collector_server.apps.collect.runtime.sink import encode_fields
from collectwire import snapshot_key

SOURCE_ID = UUID("0192f000-0000-7000-8000-000000000001")
TS_MS = 1_767_323_045_000


def test_snapshot_key_is_one_hash_per_source() -> None:
    assert (
        snapshot_key(SOURCE_ID)
        == "collect:snapshot:0192f000-0000-7000-8000-000000000001"
    )


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
