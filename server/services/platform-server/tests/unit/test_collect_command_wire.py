"""Redis 传输面的线上形状：请求进哪个键、应答从哪个键取、异常怎么收敛。

⚠ 键名与信封字段和 collector-server 的 `commands.py` 逐字一致，两边各写一份
（服务之间不许互相 import）。这条用例是那份复述的锚点。
"""

import json
from typing import Any, cast

import pytest
from redis.exceptions import RedisError

from collectwire import REQUEST_KEY, reply_key
from lib.errors import DependencyUnavailable
from platform_server.apps.collect.services.command_transport import (
    RedisCommandTransport,
)

REQUEST_ID = "req-1"


class FakeRedisClient:
    """只认 lpush / blpop / aclose 三件事的驱动替身。"""

    def __init__(self, *, reply: str | None) -> None:
        self.pushed: list[tuple[str, str]] = []
        self.popped: list[tuple[list[str], float]] = []
        self.closed = False
        self._reply = reply
        self.failure: Exception | None = None

    async def lpush(self, key: str, body: str) -> int:
        if self.failure is not None:
            raise self.failure
        self.pushed.append((key, body))
        return 1

    # ⚠ 关键字收进 `**options`：redis-py 那个形参就叫 `timeout`，而本仓的命名
    # 口径要求带单位后缀。收进来再取，两条规矩都不用破
    async def blpop(
        self, keys: list[str], **options: float
    ) -> tuple[str, str] | None:
        self.popped.append((keys, options["timeout"]))
        if self._reply is None:
            return None
        return (keys[0], self._reply)

    async def aclose(self) -> None:
        self.closed = True


def build_transport(
    *, reply: str | None
) -> tuple[RedisCommandTransport, FakeRedisClient]:
    """一条装了驱动替身的传输面。

    ⚠ 直接换掉私有的 `_client`：构造函数里的 `Redis.from_url` 不连网，但它的
    行为正是这条用例要替掉的那一层。
    Args: reply。
    """
    transport = RedisCommandTransport(
        url="redis://127.0.0.1:6379/0", block_s=10.0
    )
    client = FakeRedisClient(reply=reply)
    transport._client = cast(Any, client)
    return transport, client


async def test_the_request_lands_on_the_shared_queue() -> None:
    transport, client = build_transport(reply='{"status": "ok", "data": {}}')
    await transport.call(
        {"action": "browse"}, request_id=REQUEST_ID, timeout_s=10.0
    )
    key, body = client.pushed[0]
    assert key == REQUEST_KEY
    assert json.loads(body)["action"] == "browse"


async def test_the_wire_stamps_a_traceparent_when_the_caller_omits_it() -> None:
    transport, client = build_transport(reply='{"status": "ok", "data": {}}')
    await transport.call(
        {"action": "browse"}, request_id=REQUEST_ID, timeout_s=10.0
    )
    envelope = json.loads(client.pushed[0][1])
    assert envelope["traceparent"].startswith("00-")


async def test_a_caller_supplied_traceparent_wins() -> None:
    transport, client = build_transport(reply='{"status": "ok", "data": {}}')
    given = "00-" + "a" * 32 + "-" + "b" * 16 + "-01"
    await transport.call(
        {"action": "browse", "traceparent": given},
        request_id=REQUEST_ID,
        timeout_s=10.0,
    )
    assert json.loads(client.pushed[0][1])["traceparent"] == given


async def test_the_reply_is_awaited_on_the_per_request_key() -> None:
    transport, client = build_transport(reply='{"status": "ok", "data": {}}')
    await transport.call({}, request_id=REQUEST_ID, timeout_s=7.5)
    keys, timeout = client.popped[0]
    assert keys == [reply_key(REQUEST_ID)]
    assert timeout == 7.5


async def test_a_well_formed_reply_reaches_the_caller() -> None:
    transport, _client = build_transport(
        reply='{"status": "ok", "data": {"items": []}}'
    )
    reply = await transport.call({}, request_id=REQUEST_ID, timeout_s=1.0)
    assert reply == {"status": "ok", "data": {"items": []}}


async def test_a_blocking_timeout_reads_back_as_no_reply() -> None:
    transport, _client = build_transport(reply=None)
    assert (
        await transport.call({}, request_id=REQUEST_ID, timeout_s=1.0) is None
    )


async def test_a_driver_error_becomes_a_dependency_error() -> None:
    transport, client = build_transport(reply=None)
    client.failure = RedisError("connection reset")
    with pytest.raises(DependencyUnavailable):
        await transport.call({}, request_id=REQUEST_ID, timeout_s=1.0)


async def test_closing_releases_the_connection_pool() -> None:
    transport, client = build_transport(reply=None)
    await transport.close()
    assert client.closed is True
