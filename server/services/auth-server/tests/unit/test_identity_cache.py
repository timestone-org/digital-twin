"""身份缓存的过期、封顶与失效。

⚠ 这里守的是一条**安全**语义：缓存多留一秒，停用与降权就多晚一秒生效。
"""

import uuid
from datetime import UTC, datetime, timedelta

from auth_server.apps.auth.services.identity_cache import (
    EdgeIdentity,
    IdentityCache,
)

BASE = datetime(2026, 9, 2, tzinfo=UTC)


class FakeClock:
    """能手拨的时钟。真 sleep 会让用例慢且在慢机器上不稳。"""

    def __init__(self) -> None:
        self.now = BASE

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


def _identity(codes: frozenset[str] = frozenset()) -> EdgeIdentity:
    return EdgeIdentity(
        user_id=uuid.uuid4(),
        username="someone",
        role_name="viewer",
        is_active=True,
        codes=codes,
    )


def test_a_fresh_entry_comes_back() -> None:
    cache = IdentityCache(clock=FakeClock())
    identity = _identity()
    cache.put(identity)
    assert cache.get(identity.user_id) == identity


def test_an_unknown_account_is_a_miss() -> None:
    cache = IdentityCache(clock=FakeClock())
    assert cache.get(uuid.uuid4()) is None


def test_an_entry_older_than_the_ttl_is_a_miss() -> None:
    """⚠ 到点即失效：TTL 就是跨副本的吊销窗口。"""
    clock = FakeClock()
    cache = IdentityCache(ttl_s=10.0, clock=clock)
    identity = _identity()
    cache.put(identity)
    clock.advance(10.0)
    assert cache.get(identity.user_id) is None


def test_an_entry_just_inside_the_ttl_still_hits() -> None:
    clock = FakeClock()
    cache = IdentityCache(ttl_s=10.0, clock=clock)
    identity = _identity()
    cache.put(identity)
    clock.advance(9.9)
    assert cache.get(identity.user_id) == identity


def test_invalidate_drops_only_that_account() -> None:
    cache = IdentityCache(clock=FakeClock())
    kept, dropped = _identity(), _identity()
    cache.put(kept)
    cache.put(dropped)
    cache.invalidate(dropped.user_id)
    assert cache.get(dropped.user_id) is None
    assert cache.get(kept.user_id) == kept


def test_invalidate_all_drops_everyone() -> None:
    """角色权限一改就牵动持有它的每个账号，只能整体丢。"""
    cache = IdentityCache(clock=FakeClock())
    one, other = _identity(), _identity()
    cache.put(one)
    cache.put(other)
    cache.invalidate_all()
    assert cache.get(one.user_id) is None
    assert cache.get(other.user_id) is None


def test_invalidating_an_account_that_is_not_cached_is_a_no_op() -> None:
    cache = IdentityCache(clock=FakeClock())
    kept = _identity()
    cache.put(kept)
    cache.invalidate(uuid.uuid4())
    assert cache.get(kept.user_id) == kept


def test_the_table_never_grows_past_its_cap() -> None:
    """⚠ 不封顶就是一条随在线用户数无限长的内存曲线。"""
    cache = IdentityCache(max_entries=2, clock=FakeClock())
    first, second, third = _identity(), _identity(), _identity()
    cache.put(first)
    cache.put(second)
    cache.put(third)
    assert cache.get(first.user_id) is None
    assert cache.get(second.user_id) == second
    assert cache.get(third.user_id) == third


def test_rewriting_an_account_does_not_take_a_second_slot() -> None:
    """同一个账号刷新不算新占一格，否则封顶会把别人挤掉。"""
    cache = IdentityCache(max_entries=2, clock=FakeClock())
    kept, refreshed = _identity(), _identity()
    cache.put(kept)
    cache.put(refreshed)
    cache.put(refreshed)
    assert cache.get(kept.user_id) == kept
    assert cache.get(refreshed.user_id) == refreshed
