"""守命令总线传输面的解码：坏消息一律跳过，不许把消费循环带走。

⚠ 一条毒消息让循环退出，表现是「这个副本再也不响应浏览与写值」，而它看
起来完全正常（runtime-resilience §7）。
"""

import json

import pytest

from collector_server.commands import _decode
from collectwire import BLOCK_SOCKET_MARGIN_S

GOOD = json.dumps({"request_id": "req-1", "action": "browse"})


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "只有一个字符串",
        [],
        ["collect:cmd:req"],
        ["collect:cmd:req", 42],
        ["collect:cmd:req", "这不是 JSON"],
        ["collect:cmd:req", json.dumps([1, 2, 3])],
    ],
    ids=[
        "none",
        "not-a-pair",
        "empty",
        "key-only",
        "body-not-text",
        "body-not-json",
        "body-not-object",
    ],
)
def test_a_malformed_frame_decodes_to_nothing(raw: object) -> None:
    assert _decode(raw) is None


def test_a_well_formed_frame_decodes_to_the_envelope() -> None:
    assert _decode(["collect:cmd:req", GOOD]) == {
        "request_id": "req-1",
        "action": "browse",
    }


def test_blocking_reads_get_a_wider_socket_budget_than_the_block() -> None:
    assert BLOCK_SOCKET_MARGIN_S > 0
