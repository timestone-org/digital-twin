"""扇出循环：只发给订了该主题的连接，且一条坏消息不掀翻整个副本。

⚠ 这里守的是「副本级失联」这类故障：单条消息处理失败若让循环退出，该副本上
所有客户端会一起静默停止收数据，而没有任何一处会报错。
"""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Sequence
from datetime import timedelta
from typing import Any

from realtime_hub.apps.channel.services import (
    Connection,
    ConnectionRegistry,
    FanoutListener,
)
from realtime_hub.apps.channel.services.fanout import encode_per_name

from lib.utils.timeutils import utcnow


class FakePubSub:
    """按剧本吐消息的假 pub/sub。"""

    def __init__(self, script: list[dict[str, Any]]) -> None:
        self._script = script

    async def listen(
        self, _channels: Sequence[str]
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        for item in self._script:
            yield "ch", item


def _connection(
    sink: list[dict[str, object]], *, is_broken: bool = False
) -> Connection:
    async def send(message: dict[str, object]) -> None:
        sink.append(message)

    async def send_frame(frame: str) -> None:
        # 扇出发的是已经编码好的一帧；解回字典只为让断言仍然比结构
        if is_broken:
            raise ConnectionResetError("socket 已死")
        sink.append(json.loads(frame))

    now = utcnow()
    return Connection(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        codes=frozenset(),
        expires_at=now + timedelta(minutes=15),
        checked_at=now,
        send=send,
        send_frame=send_frame,
    )


# 假 pub/sub 的剧本是有限的，循环会自己走完；给它一点时间片再停
async def _drain(listener: FanoutListener) -> None:
    await listener.start()
    await asyncio.sleep(0.05)
    await listener.stop()


def _listener(
    script: list[dict[str, Any]], connections: ConnectionRegistry
) -> FanoutListener:
    return FanoutListener(
        pubsub=FakePubSub(script),  # type: ignore[arg-type]  # 结构相同的假件
        connections=connections,
        channel="ch",
    )


async def test_a_message_reaches_only_that_topics_subscribers() -> None:
    connections = ConnectionRegistry()
    wanted: list[dict[str, object]] = []
    other: list[dict[str, object]] = []
    subscriber = _connection(wanted)
    bystander = _connection(other)
    for item, topic in ((subscriber, "opcua:1"), (bystander, "opcua:2")):
        await connections.add(item)
        await connections.bind(item.id, topic)

    await _drain(_listener([{"topic": "opcua:1", "seq": 1}], connections))

    assert wanted == [{"topic": "opcua:1", "seq": 1}]
    assert other == []


async def test_a_broken_socket_does_not_stop_the_others() -> None:
    # ⚠ 一条已死的连接不该拖垮同主题的其它订阅者
    connections = ConnectionRegistry()
    alive: list[dict[str, object]] = []
    good = _connection(alive)
    dead = _connection([], is_broken=True)
    for item in (good, dead):
        await connections.add(item)
        await connections.bind(item.id, "opcua:1")

    await _drain(_listener([{"topic": "opcua:1", "seq": 7}], connections))

    assert alive == [{"topic": "opcua:1", "seq": 7}]


async def test_an_envelope_without_a_topic_is_skipped() -> None:
    connections = ConnectionRegistry()
    sink: list[dict[str, object]] = []
    item = _connection(sink)
    await connections.add(item)
    await connections.bind(item.id, "opcua:1")

    await _drain(
        _listener([{"seq": 1}, {"topic": "opcua:1", "seq": 2}], connections)
    )

    # 坏的那条被跳过，后一条照常送达
    assert sink == [{"topic": "opcua:1", "seq": 2}]


async def test_starting_twice_is_idempotent() -> None:
    connections = ConnectionRegistry()
    sink: list[dict[str, object]] = []
    item = _connection(sink)
    await connections.add(item)
    await connections.bind(item.id, "opcua:1")
    listener = _listener([{"topic": "opcua:1", "seq": 1}], connections)
    await listener.start()
    await listener.start()
    await asyncio.sleep(0.05)
    await listener.stop()
    # 起两次不会让同一条消息发两遍
    assert sink == [{"topic": "opcua:1", "seq": 1}]


async def test_stopping_a_listener_that_never_started_is_safe() -> None:
    listener = _listener([], ConnectionRegistry())
    await listener.stop()
    # 没起过也能安全停：关停路径不该依赖启动是否发生过
    assert tuple(ConnectionRegistry().topics()) == ()


async def test_an_aliased_connection_sees_its_own_topic_name() -> None:
    # ⚠ 匿名连接订的是别名、信封上写的是真主题。不改名的话：客户端按别名登记
    # 的处理器一条也匹配不上（连着、有数据、屏上全空），而真主题还随帧出门了
    connections = ConnectionRegistry()
    sink: list[dict[str, object]] = []
    item = _connection(sink)
    await connections.add(item)
    await connections.bind(item.id, "dashboard:d1", alias="public:tok-1")

    await _drain(_listener([{"topic": "dashboard:d1", "seq": 3}], connections))

    assert sink == [{"topic": "public:tok-1", "seq": 3}]


def _target(alias: str | None) -> Connection:
    """一条只用来问「它看到的主题名是什么」的连接。

    Args: alias。
    """
    connection = _connection([])
    if alias is not None:
        connection.aliases["dashboard:d1"] = alias
    return connection


def test_one_name_is_encoded_once_however_many_connections_hold_it() -> None:
    """一份信封按**名字**编码，不按连接编码。

    ⚠ 一帧最多 500 个条目，一面墙上二十块屏订同一张公开大屏——逐条
    `send_json` 就是同一段 JSON 序列化二十遍。
    """
    envelope = {"topic": "dashboard:d1", "seq": 7}
    targets = [_target(None), _target(None), _target("public:tok-1")]

    frames = encode_per_name(envelope, "dashboard:d1", targets)

    assert sorted(frames) == ["dashboard:d1", "public:tok-1"]


def test_an_aliased_frame_never_carries_the_real_topic() -> None:
    # ⚠ 真主题一个字都不许出门（ADR-0014）
    envelope = {"topic": "dashboard:d1", "seq": 7}

    frames = encode_per_name(envelope, "dashboard:d1", [_target("public:t")])

    assert "dashboard:d1" not in frames["public:t"]
    assert json.loads(frames["public:t"])["topic"] == "public:t"


def test_an_encoded_frame_is_byte_identical_to_what_send_json_would_write() -> (
    None
):
    # ⚠ 这一层只该省掉重复的序列化，不该改线上帧的字节
    envelope = {"topic": "dashboard:d1", "seq": 7, "payload": {"名": "值"}}

    frames = encode_per_name(envelope, "dashboard:d1", [_target(None)])

    assert frames["dashboard:d1"] == json.dumps(envelope, separators=(",", ":"))
