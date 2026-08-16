"""W3C traceparent 的组装：规整、兜底与解析往返。

⚠ 组装口径全系统只有这一份。它一旦拼出格式不合法的串，收方只会静默丢弃，
现象是链路断了却没有任何报错——所以「永远合法」是这里最重要的断言。
"""

from lib.logging import (
    bind_log_context,
    compose_traceparent,
    current_traceparent,
    new_span_id,
    new_trace_id,
    parse_traceparent,
    reset_log_context,
)

TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
SPAN_ID = "00f067aa0ba902b7"
TRACEPARENT = f"00-{TRACE_ID}-{SPAN_ID}-01"
TRACE_HEX = 32
SPAN_HEX = 16


def test_a_full_pair_composes_verbatim() -> None:
    assert compose_traceparent(TRACE_ID, SPAN_ID) == TRACEPARENT


def test_the_generators_produce_the_widths_the_spec_requires() -> None:
    assert len(new_trace_id()) == TRACE_HEX
    assert len(new_span_id()) == SPAN_HEX


def test_a_composed_traceparent_always_parses_back() -> None:
    """兜底与规整这两条路都必须产出可解析的串，否则收方会静默丢弃它。"""
    assert parse_traceparent(compose_traceparent(None, None)) is not None
    assert parse_traceparent(compose_traceparent("ABC", "-")) is not None


def test_missing_ids_are_minted_rather_than_zero_filled() -> None:
    """全零 trace id 按 W3C 无效——补零等于把链路悄悄扔掉。"""
    composed = compose_traceparent(None, None)
    assert composed.split("-")[1] != "0" * TRACE_HEX


def test_ids_are_normalised_to_the_required_width() -> None:
    """带横杠或长度不对的 id 要被规整，不能原样拼出去。"""
    composed = compose_traceparent("4bf92f35-77b3-4da6-a3ce-929d0e0e4736", "ab")
    trace, span = composed.split("-")[1:3]
    assert trace == TRACE_ID
    assert span == "ab".rjust(SPAN_HEX, "0")


def test_a_non_hex_id_is_treated_as_absent() -> None:
    """非十六进制的 id 规整不出合法串，只能当没给。"""
    composed = compose_traceparent("zzzz", SPAN_ID)
    assert parse_traceparent(composed) is not None
    assert composed.split("-")[1] != "zzzz".rjust(TRACE_HEX, "0")


def test_parsing_rejects_a_malformed_traceparent() -> None:
    assert parse_traceparent(None) is None
    assert parse_traceparent("") is None
    assert parse_traceparent(f"01-{TRACE_ID}-{SPAN_ID}-01") is None
    assert parse_traceparent(f"00-{TRACE_ID}-{SPAN_ID}") is None


def test_the_current_context_is_followed_when_there_is_one() -> None:
    token = bind_log_context(trace_id=TRACE_ID, span_id=SPAN_ID)
    try:
        assert current_traceparent() == TRACEPARENT
    finally:
        reset_log_context(token)


def test_a_fresh_link_is_minted_without_a_context() -> None:
    assert parse_traceparent(current_traceparent()) is not None
