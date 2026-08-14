"""幂等键：同键只执行一次、失败不缓存、并发同键直接冲突。

⚠ 不给键就没有幂等保证——端点「支持」它，不是要求调用方必须给。
"""

import uuid

import pytest
from pydantic import BaseModel

from lib.errors import Conflict
from lib.testing import InMemoryCache
from platform_server.apps.dashboard.services import IdempotencyStore

CALLER = uuid.UUID("0192f0c0-0000-7000-8000-0000000000aa")


class Result(BaseModel):
    """一个最小的返回体。"""

    value: int


async def test_without_a_key_every_call_runs() -> None:
    store = IdempotencyStore(cache=InMemoryCache())
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
    store = IdempotencyStore(cache=InMemoryCache())
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
    store = IdempotencyStore(cache=InMemoryCache())
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
    store = IdempotencyStore(cache=InMemoryCache())

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
    store = IdempotencyStore(cache=InMemoryCache())
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
