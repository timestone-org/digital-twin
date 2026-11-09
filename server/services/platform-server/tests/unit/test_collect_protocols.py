"""闭合集合的收窄：库里存了集合外的取值就响亮抛，不静默兜底。

守的是「兜底会让一条永远产不出数据的配置看起来完全正常」。
"""

import pytest

import collectwire
from collectwire import DATA_TYPES
from platform_server.apps.collect.protocols import (
    PROTOCOLS,
    READ_MODES,
    UnknownLiteral,
    as_data_type,
    as_protocol,
    as_read_mode,
    sql_values,
)


def test_the_closed_sets_are_sorted_and_complete() -> None:
    assert PROTOCOLS == ("http", "modbus_tcp", "opcua")
    assert READ_MODES == ("poll", "subscribe")
    assert DATA_TYPES == ("bool", "float", "int", "string")


def test_the_read_modes_match_what_the_collector_understands() -> None:
    # 配置面存下 collector 不认识的读取模式，采集起来才会暴露
    assert set(READ_MODES) == set(collectwire.READ_MODES)


def test_a_check_constraint_list_quotes_every_value() -> None:
    assert sql_values(READ_MODES) == "'poll', 'subscribe'"


def test_a_known_protocol_narrows() -> None:
    assert as_protocol("opcua") == "opcua"
    assert as_protocol("modbus_tcp") == "modbus_tcp"
    assert as_protocol("http") == "http"


def test_an_unknown_protocol_is_refused() -> None:
    with pytest.raises(UnknownLiteral):
        as_protocol("s7")


def test_both_read_modes_narrow() -> None:
    assert as_read_mode("poll") == "poll"
    assert as_read_mode("subscribe") == "subscribe"


def test_an_unknown_read_mode_is_refused() -> None:
    with pytest.raises(UnknownLiteral):
        as_read_mode("stream")


def test_every_data_type_narrows() -> None:
    assert [as_data_type(name) for name in DATA_TYPES] == list(DATA_TYPES)


def test_an_unknown_data_type_is_refused() -> None:
    with pytest.raises(UnknownLiteral):
        as_data_type("decimal")
