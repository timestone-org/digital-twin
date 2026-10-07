"""旧 owner 释放回填锁后，接任任务的取消标志仍然生效。"""

import asyncio
import uuid

from lib.cache import Cache
from platform_server.apps.dataset.services.backfill_jobs import (
    KEY_PREFIX,
    BackfillJobs,
)


class _InterleavedCache(Cache):
    def __init__(self, redis_url: str) -> None:
        super().__init__(url=redis_url)
        self.released = asyncio.Event()
        self.resume_cleanup = asyncio.Event()

    async def delete_if_owner(
        self, key: str, value: str, *, related_key: str | None = None
    ) -> bool:
        if related_key is None:
            deleted = await super().delete_if_owner(key, value)
        else:
            deleted = await super().delete_if_owner(
                key, value, related_key=related_key
            )
        if deleted and value == "old-owner":
            self.released.set()
            await self.resume_cleanup.wait()
        return deleted


async def test_old_release_preserves_the_next_owners_cancel_request(
    redis_url: str,
) -> None:
    cache = _InterleavedCache(redis_url)
    jobs = BackfillJobs(store=cache)
    table_id = uuid.uuid4()
    keys = [
        f"{KEY_PREFIX}{table_id}{suffix}" for suffix in ("", ":lock", ":cancel")
    ]
    assert await jobs.claim(table_id, "old-owner")
    cleanup = asyncio.create_task(jobs.release(table_id, "old-owner"))
    try:
        await cache.released.wait()
        assert await jobs.claim(table_id, "new-owner")
        await jobs.clear_cancel(table_id)
        await jobs.request_cancel(table_id)
        cache.resume_cleanup.set()
        await cleanup
        assert await jobs.renew(table_id, "new-owner")
        assert await jobs.is_cancelled(table_id)
    finally:
        cache.resume_cleanup.set()
        await cleanup
        for key in keys:
            await cache.delete(key)
        await cache.close()
