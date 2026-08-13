"""锁住 PubSub 的两条契约：跨连接送达，以及「没人听」不是错误。

⚠ 必须打真实 Redis：pub/sub 是即发即弃的，假件模拟不出「订阅还没建立时发的
消息就是丢了」这条语义，而调用方的整个设计（hub 不做补发）正是建立在它上面。
"""

import asyncio
from collections.abc import AsyncIterator

import pytest

from lib.cache import PubSub
from lib.cache.pubsub import TRACEPARENT_KEY
from lib.errors.base import DependencyUnavailable

CHANNEL = "lib.test.fanout"
# 订阅建立要一点时间；pub/sub 不补发，抢在它之前发的消息就是丢了
SUBSCRIBE_GRACE_S = 0.3
RECEIVE_TIMEOUT_S = 3.0
# ⚠ 触发「依赖不可用」不能用 close()：redis-py 在下一次命令时会静默重连。
# 指向一个没人听的端口，连接被立即拒绝，才是稳定的失败注入
UNREACHABLE_REDIS_URL = "redis://127.0.0.1:1/0"


@pytest.fixture
async def listener(redis_url: str) -> AsyncIterator[PubSub]:
    handle = PubSub(url=redis_url, timeout_s=2.0)
    yield handle
    await handle.close()


@pytest.fixture
async def sender(redis_url: str) -> AsyncIterator[PubSub]:
    handle = PubSub(url=redis_url, timeout_s=2.0)
    yield handle
    await handle.close()


async def test_a_message_reaches_a_listener_on_another_connection(
    listener: PubSub, sender: PubSub
) -> None:
    received: list[dict[str, object]] = []

    async def collect() -> None:
        async for _channel, payload in listener.listen([CHANNEL]):
            received.append(payload)
            return

    task = asyncio.create_task(collect())
    try:
        await asyncio.sleep(SUBSCRIBE_GRACE_S)
        await sender.publish(CHANNEL, {"topic": "opcua:1", "seq": 7})
        await asyncio.wait_for(task, timeout=RECEIVE_TIMEOUT_S)
    finally:
        task.cancel()
    assert len(received) == 1
    envelope = received[0]
    assert envelope["topic"] == "opcua:1"
    assert envelope["seq"] == 7
    # ⚠ 信封必须带 traceparent：pub/sub 跨进程，contextvars 传不过去，
    # 不带它链路就在这里齐断
    assert TRACEPARENT_KEY in envelope


async def test_publish_returns_zero_when_nobody_listens(
    sender: PubSub,
) -> None:
    # ⚠ 0 不是错误：调用方不能把它当成「发失败了」去重试
    assert await sender.publish("lib.test.nobody", {"a": 1}) == 0


async def test_publishing_when_redis_is_unreachable_reports_the_dependency() -> (
    None
):
    """⚠ 基础设施异常不许裸露给上层。

    调用方要能按「依赖不可用」降级，而不是去认识 redis 的异常类型——
    hub 那边正是据它决定「这一批推不出去，客户端靠 seq 自己补」。
    """
    sender = PubSub(url=UNREACHABLE_REDIS_URL, timeout_s=0.2)
    with pytest.raises(DependencyUnavailable):
        await sender.publish(CHANNEL, {"a": 1})
    await sender.close()


async def test_listening_when_redis_is_unreachable_reports_the_dependency() -> (
    None
):
    listener = PubSub(url=UNREACHABLE_REDIS_URL, timeout_s=0.2)

    async def take_one() -> None:
        async for _channel, _payload in listener.listen([CHANNEL]):
            break

    with pytest.raises(DependencyUnavailable):
        await take_one()
    await listener.close()
