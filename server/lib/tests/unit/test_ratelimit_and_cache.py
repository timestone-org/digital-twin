"""锁住限流与缓存假件的语义，并让假件与真实现的公开面保持同构。

⚠ 假件与真实现漂移是所有测试替身里最危险的一类：它让「生产坏了、测试全绿」成立。
这里用公开面比对钉住方法签名，行为差异由打真 Redis 的集成用例覆盖。
"""

import inspect

import pytest

from lib.cache.client import Cache
from lib.cache.protocol import CacheLike
from lib.errors import DependencyUnavailable, RateLimited
from lib.ratelimit import FixedWindowLimiter
from lib.testing import InMemoryCache, UnavailableCache


def public_surface(target: type) -> dict[str, str]:
    return {
        name: str(inspect.signature(member))
        for name, member in inspect.getmembers(
            target, predicate=inspect.isfunction
        )
        if not name.startswith("_")
    }


@pytest.mark.parametrize(
    "double", [InMemoryCache, UnavailableCache], ids=["memory", "unavailable"]
)
def test_cache_doubles_match_the_real_public_surface(
    double: type,
) -> None:
    expected = public_surface(Cache)
    actual = public_surface(double)
    assert set(expected) <= set(actual)
    for name, signature in expected.items():
        assert actual[name] == signature, name


def test_protocol_declares_the_same_names_as_the_real_client() -> None:
    declared = {name for name in dir(CacheLike) if not name.startswith("_")}
    assert declared == set(public_surface(Cache))


async def test_limiter_allows_up_to_the_limit_then_rejects() -> None:
    limiter = FixedWindowLimiter(
        cache=InMemoryCache(), namespace="login", limit=3, window_s=60
    )
    for _ in range(3):
        await limiter.hit("alice")
    with pytest.raises(RateLimited):
        await limiter.hit("alice")


async def test_limiter_counts_each_identity_separately() -> None:
    cache = InMemoryCache()
    limiter = FixedWindowLimiter(
        cache=cache, namespace="login", limit=1, window_s=60
    )
    await limiter.hit("alice")
    await limiter.hit("bob")
    assert cache.store["ratelimit:login:alice"] == "1"
    assert cache.store["ratelimit:login:bob"] == "1"


async def test_reset_clears_the_counter() -> None:
    cache = InMemoryCache()
    limiter = FixedWindowLimiter(
        cache=cache, namespace="login", limit=1, window_s=60
    )
    await limiter.hit("alice")
    await limiter.reset("alice")
    assert "ratelimit:login:alice" not in cache.store
    await limiter.hit("alice")
    assert cache.store["ratelimit:login:alice"] == "1"


async def test_limiter_fails_closed_when_the_cache_is_unreachable() -> None:
    limiter = FixedWindowLimiter(
        cache=UnavailableCache(), namespace="login", limit=3, window_s=60
    )
    with pytest.raises(DependencyUnavailable):
        await limiter.hit("alice")


async def test_in_memory_cache_roundtrips_json_and_ttl() -> None:
    cache = InMemoryCache()
    await cache.set_json("k", {"a": 1}, ttl_s=30)
    assert await cache.get_json("k") == {"a": 1}
    assert cache.ttl_s["k"] == 30
    await cache.delete("k")
    assert await cache.get_json("k") is None


async def test_set_if_absent_is_the_mutual_exclusion_primitive() -> None:
    cache = InMemoryCache()
    assert await cache.set_if_absent("lock", "owner", ttl_s=5)
    assert not await cache.set_if_absent("lock", "other", ttl_s=5)


async def test_corrupt_json_reads_as_none_rather_than_raising() -> None:
    cache = InMemoryCache()
    cache.store["k"] = "{not json"
    assert await cache.get_json("k") is None
