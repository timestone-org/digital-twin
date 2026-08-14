"""守条目的解码：坏条目一律降级成「跳过」，绝不抛。

⚠ 一条解不开的条目若把落库循环带崩，这条流之后就再也排不出去，这个数据源的
历史会**全部**停在那一刻（COLLECT_DESIGN.md §4.3 ⑦）。
"""

import json

from collector_server.stream import ROWS_FIELD, decode_entry

ROW = {
    "point_code": "outlet_temp",
    "value": 21.5,
    "ts_ms": 1,
    "quality": "good",
}


def entry(body: object) -> tuple[str, dict[str, object]]:
    """造一项 XRANGE 回包。

    Args: body。
    """
    return ("1-0", {ROWS_FIELD: body})


def test_a_well_formed_entry_yields_its_rows() -> None:
    decoded = decode_entry(entry(json.dumps([ROW])))
    assert decoded is not None
    assert decoded.rows == (ROW,)


def test_the_entry_id_is_kept_for_the_delete_that_follows() -> None:
    decoded = decode_entry(entry(json.dumps([ROW])))
    assert decoded is not None
    assert decoded.entry_id == "1-0"


def test_an_item_that_is_not_a_pair_is_skipped() -> None:
    assert decode_entry("not-a-pair") is None


def test_an_entry_without_fields_is_skipped() -> None:
    assert decode_entry(("1-0",)) is None


def test_an_entry_whose_id_is_not_text_is_skipped() -> None:
    assert decode_entry((1, {ROWS_FIELD: "[]"})) is None


def test_an_entry_without_the_rows_field_is_skipped() -> None:
    assert decode_entry(("1-0", {"invented_later": "[]"})) is None


def test_an_entry_whose_body_is_not_json_yields_no_rows() -> None:
    decoded = decode_entry(entry("not-json"))
    assert decoded is not None
    assert decoded.rows == ()


def test_an_entry_whose_body_is_not_a_list_yields_no_rows() -> None:
    decoded = decode_entry(entry(json.dumps({"point_code": "outlet_temp"})))
    assert decoded is not None
    assert decoded.rows == ()


def test_a_row_that_is_not_an_object_is_dropped_from_the_batch() -> None:
    decoded = decode_entry(entry(json.dumps([ROW, "junk"])))
    assert decoded is not None
    assert decoded.rows == (ROW,)
