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
