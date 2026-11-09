"""Redis Stream 的 pending 续期必须保 owner，接管后旧 owner 不能抢回。"""

import asyncio
import uuid

from lib.stream import RedisStream, StreamGroup


async def test_touch_never_takes_ownership_back(redis_url: str) -> None:
    stream_name = f"lib-test:stream:{uuid.uuid4()}"
    first = StreamGroup(stream_name, "workers", "first")
    second = StreamGroup(stream_name, "workers", "second")
    stream = RedisStream(url=redis_url, timeout_s=2.0)
    try:
        await stream.ensure_group(first)
        entry_id = await stream.publish(stream_name, {"kind": "probe"})
        received = await stream.read_group(first, count=1, block_ms=10)
        assert [one.entry_id for one in received] == [entry_id]
        assert await stream.touch(first, entry_id) is True

        claimed = await stream.claim_stale(second, min_idle_ms=0, count=1)
        assert [one.entry_id for one in claimed] == [entry_id]
        assert await stream.touch(first, entry_id) is False
        assert await stream.touch(second, entry_id) is True
        assert await stream.ack_if_owned(first, entry_id) is False
        assert await stream.ack_if_owned(second, entry_id) is True
    finally:
        await stream._client.delete(stream_name)
        await stream.close()


async def test_claim_scan_reaches_stale_entries_behind_a_live_prefix(
    redis_url: str,
) -> None:
    """COUNT=1 只扫十条；游标不前进时第十一条会永久饥饿。"""
    stream_name = f"lib-test:stream:{uuid.uuid4()}"
    first = StreamGroup(stream_name, "workers", "first")
    second = StreamGroup(stream_name, "workers", "second")
    stream = RedisStream(url=redis_url, timeout_s=2.0)
    try:
        await stream.ensure_group(first)
        ids = [
            await stream.publish(stream_name, {"position": str(position)})
            for position in range(11)
        ]
        received = await stream.read_group(first, count=11, block_ms=10)
        assert [one.entry_id for one in received] == ids
        await asyncio.sleep(0.15)
        for entry_id in ids[:10]:
            assert await stream.touch(first, entry_id) is True

        first_page = await stream.claim_stale(second, min_idle_ms=100, count=1)
        second_page = await stream.claim_stale(second, min_idle_ms=100, count=1)

        assert first_page == []
        assert [one.entry_id for one in second_page] == [ids[10]]
    finally:
        await stream._client.delete(stream_name)
        await stream.close()


async def _one_delivered(stream: RedisStream, target: StreamGroup) -> str:
    await stream.ensure_group(target)
    entry_id = await stream.publish(target.stream, {"kind": "job"})
    await stream.read_group(target, count=1, block_ms=10)
    return entry_id


async def test_ack_leaves_the_entry_in_the_stream_by_default(
    redis_url: str,
) -> None:
    target = StreamGroup(f"lib-test:stream:{uuid.uuid4()}", "workers", "w")
    stream = RedisStream(url=redis_url, timeout_s=2.0)
    try:
        entry_id = await _one_delivered(stream, target)
        await stream.ack(target, entry_id)
        assert await stream._client.xlen(target.stream) == 1
    finally:
        await stream._client.delete(target.stream)
        await stream.close()


async def test_delete_on_ack_keeps_a_job_stream_from_growing(
    redis_url: str,
) -> None:
    """⚠ 只 XACK 的话，确认过的条目永远留在流里，Redis 内存单调涨。"""
    target = StreamGroup(f"lib-test:stream:{uuid.uuid4()}", "workers", "w")
    stream = RedisStream(url=redis_url, timeout_s=2.0, delete_on_ack=True)
    try:
        entry_id = await _one_delivered(stream, target)
        await stream.ack(target, entry_id)
        assert await stream._client.xlen(target.stream) == 0

        owned = await _one_delivered(stream, target)
        assert await stream.ack_if_owned(target, owned) is True
        assert await stream._client.xlen(target.stream) == 0
    finally:
        await stream._client.delete(target.stream)
        await stream.close()


async def test_delete_on_ack_never_removes_an_entry_it_does_not_own(
    redis_url: str,
) -> None:
    first = StreamGroup(f"lib-test:stream:{uuid.uuid4()}", "workers", "a")
    second = StreamGroup(first.stream, "workers", "b")
    stream = RedisStream(url=redis_url, timeout_s=2.0, delete_on_ack=True)
    try:
        entry_id = await _one_delivered(stream, first)
        await stream.claim_stale(second, min_idle_ms=0, count=1)
        assert await stream.ack_if_owned(first, entry_id) is False
        assert await stream._client.xlen(first.stream) == 1
    finally:
        await stream._client.delete(first.stream)
        await stream.close()
