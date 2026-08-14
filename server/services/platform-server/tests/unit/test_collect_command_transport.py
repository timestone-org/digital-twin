"""Redis 传输面的解码契约：坏应答按「没结论」处理，不抛成 500。

守的是「一条坏应答与现场没答复对调用方是同一件事」。
"""

from platform_server.apps.collect.services.command_transport import (
    BLOCK_SOCKET_MARGIN_S,
    REPLY_PREFIX,
    REQUEST_KEY,
    _decode,
    reply_key,
)


def test_the_request_key_matches_the_collector_side() -> None:
    assert REQUEST_KEY == "collect:cmd:req"


def test_the_reply_key_is_namespaced_per_request() -> None:
    assert REPLY_PREFIX == "collect:cmd:reply"
    assert reply_key("abc") == "collect:cmd:reply:abc"


def test_the_socket_budget_exceeds_the_block_time() -> None:
    # ⚠ 少了这条余量，阻塞满一拍就会被驱动层判成读超时
    assert BLOCK_SOCKET_MARGIN_S > 0


def test_a_blpop_timeout_decodes_to_no_reply() -> None:
    assert _decode(None) is None


def test_a_short_pair_decodes_to_no_reply() -> None:
    assert _decode(["collect:cmd:reply:abc"]) is None


def test_a_non_string_body_decodes_to_no_reply() -> None:
    assert _decode(["collect:cmd:reply:abc", 42]) is None


def test_undecodable_json_decodes_to_no_reply() -> None:
    assert _decode(["collect:cmd:reply:abc", "{不是 json"]) is None


def test_a_json_array_body_decodes_to_no_reply() -> None:
    assert _decode(["collect:cmd:reply:abc", "[1, 2]"]) is None


def test_a_well_formed_reply_decodes_to_the_envelope() -> None:
    decoded = _decode(
        ["collect:cmd:reply:abc", '{"status": "ok", "data": {"items": []}}']
    )
    assert decoded == {"status": "ok", "data": {"items": []}}
