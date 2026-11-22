"""守命令总线传输面的解码：坏消息一律跳过，不许把消费循环带走。

⚠ 一条毒消息让循环退出，表现是「这个副本再也不响应浏览与写值」，而它看
起来完全正常（runtime-resilience §7）。
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from redis.exceptions import TimeoutError as RedisTimeoutError

from collector_server.commands import RedisCommandTransport, _decode
from lib.errors import DependencyUnavailable

GOOD = json.dumps({"request_id": "req-1", "action": "browse"})


@pytest.mark.parametrize(
    "raw",
    [None, 42, "这不是 JSON", json.dumps([1, 2, 3])],
    ids=["none", "not-text", "not-json", "not-object"],
)
def test_a_malformed_frame_decodes_to_nothing(raw: object) -> None:
    assert _decode(raw) is None


def test_a_well_formed_frame_decodes_to_the_envelope() -> None:
    assert _decode(GOOD) == {
        "request_id": "req-1",
        "action": "browse",
    }


async def test_command_take_does_not_send_again_after_losing_the_reply(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = RedisCommandTransport(
        url="redis://127.0.0.1:1/0",
        lease=SimpleNamespace(key="test:lease", token="test-owner"),
        timeout_s=1.0,
    )
    client = transport._client
    connection = client.connection_pool.make_connection()
    sent = AsyncMock(side_effect=RedisTimeoutError("reply lost"))
    try:
        with monkeypatch.context() as patch:
            patch.setattr(client, "connection", connection)
            patch.setattr(client, "_send_command_parse_response", sent)
            with pytest.raises(DependencyUnavailable):
                await transport.take(block_s=1.0)
            sent.assert_awaited_once()
    finally:
        await transport.close()
