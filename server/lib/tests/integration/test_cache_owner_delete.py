"""真实缓存与假件的 owner 条件删除及关联键清理遵守同一契约。"""

import uuid
from collections.abc import AsyncIterator

import pytest

from lib.cache import Cache, CacheLike
from lib.testing import InMemoryCache


@pytest.fixture(params=["redis", "memory"])
async def owner_cache(
    request: pytest.FixtureRequest, redis_url: str
) -> AsyncIterator[CacheLike]:
    cache = (
        Cache(url=redis_url) if request.param == "redis" else InMemoryCache()
    )
    yield cache
    await cache.close()


@pytest.mark.parametrize(
    "has_related", [False, True], ids=["single-key", "with-related"]
)
async def test_owner_delete_removes_only_matching_owner_keys(
    owner_cache: CacheLike, has_related: bool
) -> None:
    key = f"owner-delete-test:{uuid.uuid4()}"
    related = f"{key}:related" if has_related else None
    try:
        assert await owner_cache.set_if_absent(key, "owner", ttl_s=30)
        if related is not None:
            await owner_cache.set_json(related, True, ttl_s=30)
        assert not await owner_cache.delete_if_owner(
            key, "other", related_key=related
        )
        assert await owner_cache.get(key) == "owner"
        if related is not None:
            assert await owner_cache.exists(related)
        assert await owner_cache.delete_if_owner(
            key, "owner", related_key=related
        )
        assert not await owner_cache.exists(key)
        if related is not None:
            assert not await owner_cache.exists(related)
        assert not await owner_cache.delete_if_owner(
            key, "owner", related_key=related
        )
    finally:
        await owner_cache.delete(key)
        if related is not None:
            await owner_cache.delete(related)
