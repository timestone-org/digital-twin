"""幂等键：同键只执行一次、失败不缓存、并发同键直接冲突。

⚠ 不给键就没有幂等保证——端点「支持」它，不是要求调用方必须给。
"""

import asyncio
import uuid
from typing import Any

import pytest
from pydantic import BaseModel

from lib.errors import AppError, Conflict, DependencyUnavailable
from lib.idempotency import CLAIM_TTL_S, RESULT_TTL_S, IdempotencyStore
from lib.testing import InMemoryCache

CALLER = uuid.UUID("0192f0c0-0000-7000-8000-0000000000aa")
NAMESPACE = "svc"


def build_store() -> IdempotencyStore:
    """一个打进程内缓存的幂等存储。"""
    return IdempotencyStore(cache=InMemoryCache(), namespace=NAMESPACE)


class Result(BaseModel):
    """一个最小的返回体。"""

    value: int


async def test_lookup_only_reads_an_existing_result() -> None:
    store = build_store()
    missing = await store.lookup_result(
        endpoint="create", key="k1", caller=CALLER, model=Result
    )
    assert missing is None

    async def action() -> Result:
        return Result(value=17)

    await store.run_once(
        endpoint="create", key="k1", caller=CALLER, model=Result, action=action
    )
    cached = await store.lookup_result(
        endpoint="create", key="k1", caller=CALLER, model=Result
    )
    other = await store.lookup_result(
        endpoint="other", key="k1", caller=CALLER, model=Result
    )
    assert cached == Result(value=17)
    assert other is None


async def test_without_a_key_every_call_runs() -> None:
    store = build_store()
    calls: list[int] = []

    async def action() -> Result:
        calls.append(1)
        return Result(value=len(calls))

    first = await store.run_once(
        endpoint="create", key=None, caller=CALLER, model=Result, action=action
    )
    second = await store.run_once(
        endpoint="create", key=None, caller=CALLER, model=Result, action=action
    )
    assert (first.value, second.value) == (1, 2)


async def test_the_same_key_replays_the_first_result() -> None:
    store = build_store()
    calls: list[int] = []

    async def action() -> Result:
        calls.append(1)
        return Result(value=len(calls))

    first = await store.run_once(
        endpoint="create", key="k1", caller=CALLER, model=Result, action=action
    )
    second = await store.run_once(
        endpoint="create", key="k1", caller=CALLER, model=Result, action=action
    )
    assert (first.value, second.value, len(calls)) == (1, 1, 1)


async def test_a_different_caller_does_not_share_the_key() -> None:
    store = build_store()
    other = uuid.UUID("0192f0c0-0000-7000-8000-0000000000bb")

    async def action() -> Result:
        return Result(value=7)

    await store.run_once(
        endpoint="create", key="k1", caller=CALLER, model=Result, action=action
    )
    calls: list[int] = []

    async def counted() -> Result:
        calls.append(1)
        return Result(value=9)

    result = await store.run_once(
        endpoint="create", key="k1", caller=other, model=Result, action=counted
    )
    assert (result.value, len(calls)) == (9, 1)


async def test_a_failed_call_lets_the_same_key_be_retried() -> None:
    store = build_store()

    async def failing() -> Result:
        raise RuntimeError("下游抖了一下")

    with pytest.raises(RuntimeError):
        await store.run_once(
            endpoint="create",
            key="k1",
            caller=CALLER,
            model=Result,
            action=failing,
        )

    async def succeeding() -> Result:
        return Result(value=3)

    result = await store.run_once(
        endpoint="create",
        key="k1",
        caller=CALLER,
        model=Result,
        action=succeeding,
    )
    assert result.value == 3


async def test_a_key_still_in_flight_conflicts() -> None:
    store = build_store()
    await store._claim(endpoint="create", key="k1", caller=CALLER)

    async def action() -> Result:
        return Result(value=1)

    with pytest.raises(Conflict):
        await store.run_once(
            endpoint="create",
            key="k1",
            caller=CALLER,
            model=Result,
            action=action,
        )


async def test_two_namespaces_do_not_replay_each_other() -> None:
    """⚠ 共用一个缓存的两个服务，同一个端点名撞上同一个键时不许串结果。"""
    cache = InMemoryCache()
    first = IdempotencyStore(cache=cache, namespace="one")
    second = IdempotencyStore(cache=cache, namespace="two")
    calls: list[int] = []

    async def action() -> Result:
        calls.append(1)
        return Result(value=len(calls))

    started = await first.run_once(
        endpoint="e", key="k", caller=CALLER, model=Result, action=action
    )
    other = await second.run_once(
        endpoint="e", key="k", caller=CALLER, model=Result, action=action
    )
    assert (started.value, other.value) == (1, 2)


class _ResultStoreDown(InMemoryCache):
    """占位能写进去，存结果那一下 Redis 抖了。"""

    async def set_json(self, key: str, value: Any, *, ttl_s: int) -> None:
        del key, value, ttl_s
        raise DependencyUnavailable("缓存暂时不可用")


async def test_a_failed_result_store_still_reports_the_action_succeeded() -> (
    None
):
    """⚠ 动作已经做了却回 503，调用方按可重试去重试，占位一过期就做第二遍。"""
    store = IdempotencyStore(cache=_ResultStoreDown(), namespace=NAMESPACE)
    calls: list[int] = []

    async def action() -> Result:
        calls.append(1)
        return Result(value=7)

    got = await store.run_once(
        endpoint="write", key="k1", caller=CALLER, model=Result, action=action
    )
    assert got == Result(value=7)
    assert calls == [1]


class _OutcomeUnknown(AppError):
    """测试替代的未确认写入错误。"""

    is_outcome_unknown = True


async def test_an_unconfirmed_result_keeps_the_key_for_the_result_ttl() -> None:
    cache = InMemoryCache()
    store = IdempotencyStore(cache=cache, namespace=NAMESPACE)
    requests: list[int] = []

    async def perform() -> Result:
        requests.append(1)
        raise _OutcomeUnknown("下游结果未知")

    with pytest.raises(_OutcomeUnknown, match="下游结果未知"):
        await store.run_once(
            endpoint="write",
            key="k1",
            caller=CALLER,
            model=Result,
            action=perform,
        )
    with pytest.raises(Conflict, match="未确认"):
        await store.run_once(
            endpoint="write",
            key="k1",
            caller=CALLER,
            model=Result,
            action=perform,
        )
    assert requests == [1]
    assert list(cache.ttl_s.values()) == [RESULT_TTL_S]


class _RetentionUnavailable(InMemoryCache):
    """保留初始占位，无法延长它的有效期。"""

    async def renew_if_owner(
        self,
        key: str,
        value: str,
        *,
        ttl_s: int,
        replacement: str | None = None,
    ) -> bool:
        del key, value, ttl_s, replacement
        raise DependencyUnavailable("缓存暂时不可用")


async def test_failed_retention_still_preserves_the_initial_reservation() -> (
    None
):
    cache = _RetentionUnavailable()
    store = IdempotencyStore(cache=cache, namespace=NAMESPACE)
    calls: list[bool] = []

    async def perform() -> Result:
        calls.append(True)
        raise _OutcomeUnknown("下游结果未知")

    with pytest.raises(_OutcomeUnknown):
        await store.run_once(
            endpoint="write",
            key="k1",
            caller=CALLER,
            model=Result,
            action=perform,
        )
    with pytest.raises(Conflict):
        await store.run_once(
            endpoint="write",
            key="k1",
            caller=CALLER,
            model=Result,
            action=perform,
        )
    assert calls == [True]


@pytest.mark.parametrize(
    "should_protect", [False, True], ids=["default", "full"]
)
async def test_cancellation_keeps_the_reserved_ttl(
    should_protect: bool,
) -> None:
    cache = InMemoryCache()
    store = IdempotencyStore(
        cache=cache,
        namespace=NAMESPACE,
        should_reserve_full_window=should_protect,
    )
    entered = asyncio.Event()

    async def wait_for_result() -> Result:
        entered.set()
        await asyncio.Event().wait()
        raise AssertionError("取消后不会进入成功路径")

    pending = asyncio.create_task(
        store.run_once(
            endpoint="write",
            key="k1",
            caller=CALLER,
            model=Result,
            action=wait_for_result,
        )
    )
    try:
        await asyncio.wait_for(entered.wait(), timeout=1)
        ttl_s = RESULT_TTL_S if should_protect else CLAIM_TTL_S
        assert list(cache.ttl_s.values()) == [ttl_s]
    finally:
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
    assert list(cache.ttl_s.values()) == [ttl_s]


async def test_full_window_keeps_an_unexpected_failure() -> None:
    cache = InMemoryCache()
    store = IdempotencyStore(
        cache=cache, namespace=NAMESPACE, should_reserve_full_window=True
    )

    async def action() -> Result:
        raise RuntimeError("假设备处理中的意外错误")

    with pytest.raises(RuntimeError, match="意外错误"):
        await store.run_once(
            endpoint="write",
            key="k1",
            caller=CALLER,
            model=Result,
            action=action,
        )
    with pytest.raises(Conflict, match="结果未确认"):
        await store.run_once(
            endpoint="write",
            key="k1",
            caller=CALLER,
            model=Result,
            action=action,
        )
    assert list(cache.ttl_s.values()) == [RESULT_TTL_S]


async def test_long_reservation_releases_confirmed_failures() -> None:
    cache = InMemoryCache()
    store = IdempotencyStore.for_database_writes(cache, NAMESPACE)
    attempts = []

    async def write() -> Result:
        attempts.append(1)
        assert list(cache.ttl_s.values()) == [RESULT_TTL_S]
        if len(attempts) == 1:
            raise ValueError("明确未完成")
        return Result(value=1)

    with pytest.raises(ValueError, match="明确未完成"):
        await store.run_once(
            endpoint="create",
            key="k",
            caller=CALLER,
            model=Result,
            action=write,
        )
    result = await store.run_once(
        endpoint="create", key="k", caller=CALLER, model=Result, action=write
    )
    assert result.value == 1


def test_nonpositive_claim_lifetime_is_rejected() -> None:
    with pytest.raises(ValueError, match="正数"):
        IdempotencyStore(
            cache=InMemoryCache(), namespace=NAMESPACE, claim_ttl_s=0
        )
