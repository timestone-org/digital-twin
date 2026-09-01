"""Redis Stream 适配层的用例：回包形状、异常收敛、消费组已存在。

⚠ 最容易写错的是回包剥层：XREADGROUP 按流分组回，只有一条流也要先剥一层，
不剥就会把 `(流名, 消息表)` 这个元组当成一条消息。
"""

from typing import Any

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import ResponseError

from lib.errors import DependencyUnavailable
from lib.stream import (
    RedisStream,
    StreamGroup,
    _entries,
    _from_claim,
    _from_read,
)

TARGET = StreamGroup(stream="s", group="g", consumer="c")
FIELDS = {"month": "2026-01", "traceparent": "00-abc-def-01"}


class FakeRedis:
    """记下调用并按脚本回包的假驱动。"""

    def __init__(self, *, failure: Exception | None = None) -> None:
        self.failure = failure
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.read_reply: Any = []
        self.claim_reply: Any = []

    def _record(self, name: str, *args: Any) -> None:
        self.calls.append((name, args))
        if self.failure is not None:
            raise self.failure

    async def ping(self) -> bool:
        self._record("ping")
        return True

    async def xadd(self, stream: str, fields: Any) -> str:
        self._record("xadd", stream, fields)
        return "5-0"

    async def xgroup_create(
        self, stream: str, group: str, **options: object
    ) -> None:
        self._record("xgroup_create", stream, group, options)

    async def xreadgroup(
        self, group: str, consumer: str, streams: dict[str, str], **kw: object
    ) -> Any:
        self._record("xreadgroup", group, consumer, streams, kw)
        return self.read_reply

    async def xautoclaim(
        self, stream: str, group: str, consumer: str, **kw: object
    ) -> Any:
        self._record("xautoclaim", stream, group, consumer, kw)
        return self.claim_reply

    async def xack(self, stream: str, group: str, entry_id: str) -> int:
        self._record("xack", stream, group, entry_id)
        return 1

    async def aclose(self) -> None:
        self._record("aclose")


def build_stream(fake: FakeRedis) -> RedisStream:
    """一个把驱动换成假件的客户端。

    Args: fake。
    """
    stream = RedisStream(url="redis://127.0.0.1:6379/0")
    stream._client = fake  # pyright: ignore[reportAttributeAccessIssue]
    return stream


def test_a_read_reply_is_unwrapped_from_its_stream_grouping() -> None:
    """⚠ 回包按流分组，一条流也要先剥一层。"""
    reply = [["s", [("1-0", FIELDS), ("2-0", FIELDS)]]]
    assert [item.entry_id for item in _from_read(reply)] == ["1-0", "2-0"]


def test_an_empty_read_reply_yields_nothing() -> None:
    """阻塞到超时会回一个空表，不是错误。"""
    assert _from_read(None) == []
    assert _from_read([]) == []


def test_a_claim_reply_takes_the_middle_section() -> None:
    """XAUTOCLAIM 回的是「下一个游标 / 消息表 / 已删表」三段。"""
    reply = ("0-0", [("7-0", FIELDS)], [])
    assert [item.entry_id for item in _from_claim(reply)] == ["7-0"]


def test_a_short_claim_reply_yields_nothing() -> None:
    """形状不符的回包按空处理，不抛。"""
    assert _from_claim(["0-0"]) == []


@pytest.mark.parametrize(
    "messages",
    [None, [("1-0",)], [("1-0", "not-a-dict")]],
    ids=["none", "short-pair", "non-dict-fields"],
)
def test_malformed_entries_are_skipped(messages: Any) -> None:
    """形状不符的条目跳过，不让半条消息流进业务层。"""
    assert _entries(messages) == []


def test_entry_fields_come_back_as_text() -> None:
    """键值一律收成字符串，消费端不必再判类型。"""
    found = _entries([("1-0", {"month": "2026-01", "count": 3})])
    assert found[0].fields == {"month": "2026-01", "count": "3"}


async def test_publishing_returns_the_entry_id() -> None:
    """投递回条目 id，调用方据此在日志里对齐。"""
    fake = FakeRedis()
    assert await build_stream(fake).publish("s", FIELDS) == "5-0"
    assert fake.calls[0][0] == "xadd"


async def test_creating_a_group_makes_the_stream_when_missing() -> None:
    """⚠ mkstream 不能省：流还没消息时建组直接报错，而全新部署正是这样。"""
    fake = FakeRedis()
    await build_stream(fake).ensure_group(TARGET)
    assert fake.calls[0][1][2] == {"id": "0", "mkstream": True}


async def test_an_existing_group_is_treated_as_ready() -> None:
    """组已存在不是错误——多副本 worker 都会抢着建它。"""
    fake = FakeRedis(failure=ResponseError("BUSYGROUP already exists"))
    await build_stream(fake).ensure_group(TARGET)
    assert fake.calls[0][0] == "xgroup_create"


async def test_another_group_error_becomes_unavailable() -> None:
    """别的建组错误一律收敛成依赖不可用，不裸露驱动异常。"""
    fake = FakeRedis(failure=ResponseError("WRONGTYPE"))
    with pytest.raises(DependencyUnavailable):
        await build_stream(fake).ensure_group(TARGET)


async def test_a_connection_failure_while_creating_a_group_is_converted() -> (
    None
):
    """连不上时同样收敛成依赖不可用。"""
    fake = FakeRedis(failure=RedisConnectionError("down"))
    with pytest.raises(DependencyUnavailable):
        await build_stream(fake).ensure_group(TARGET)


async def test_reading_passes_the_new_messages_marker() -> None:
    """只取还没派出去的新消息，待确认的那些走认领。"""
    fake = FakeRedis()
    fake.read_reply = [["s", [("1-0", FIELDS)]]]
    found = await build_stream(fake).read_group(TARGET, count=4, block_ms=10)
    assert [item.entry_id for item in found] == ["1-0"]
    assert fake.calls[0][1][2] == {"s": ">"}


async def test_claiming_passes_the_idle_threshold() -> None:
    """认领要带上「多久没确认才算滞留」。"""
    fake = FakeRedis()
    fake.claim_reply = ("0-0", [("1-0", FIELDS)], [])
    found = await build_stream(fake).claim_stale(
        TARGET, min_idle_ms=60000, count=4
    )
    assert [item.entry_id for item in found] == ["1-0"]
    assert fake.calls[0][1][3]["min_idle_time"] == 60000


async def test_acking_names_the_stream_and_group() -> None:
    """确认要指明是哪条流哪个组的哪一条。"""
    fake = FakeRedis()
    await build_stream(fake).ack(TARGET, "1-0")
    assert fake.calls[0] == ("xack", ("s", "g", "1-0"))


async def test_a_driver_error_becomes_dependency_unavailable() -> None:
    """驱动异常不裸露给上层，业务层不必认识第三方异常类型。"""
    fake = FakeRedis(failure=RedisConnectionError("down"))
    with pytest.raises(DependencyUnavailable):
        await build_stream(fake).publish("s", FIELDS)


async def test_ping_reports_unreachable_without_raising() -> None:
    """自检只回答通不通，不抛——它要能进启动流程而不阻断启动。"""
    fake = FakeRedis(failure=RedisConnectionError("down"))
    assert await build_stream(fake).ping() is False


async def test_ping_reports_reachable() -> None:
    """连得上就是 True。"""
    assert await build_stream(FakeRedis()).ping() is True


async def test_closing_releases_the_pool() -> None:
    """关掉连接池。"""
    fake = FakeRedis()
    await build_stream(fake).close()
    assert fake.calls[0][0] == "aclose"


def test_a_malformed_stream_grouping_is_skipped() -> None:
    """回包里形状不符的那一组跳过，不让半条消息流进业务层。"""
    assert _from_read([["s"]]) == []
