"""守计划的版本比对与降级方向：拿不到就空转、版本没变就别动。

⚠ 用错的计划采数据比不采更糟——它会写出看似正常的错误历史（ADR-0001）。
"""

from typing import Any

from collector_server.apps.collect.errors import PlanUnavailable
from collector_server.apps.collect.plan.store import PlanStore


class ScriptedFetcher:
    """按脚本轮流给出计划或抛错。"""

    def __init__(self, script: list[Any]) -> None:
        self.script = script
        self.calls = 0

    async def fetch(self) -> Any:
        self.calls += 1
        step = self.script[min(self.calls - 1, len(self.script) - 1)]
        if isinstance(step, Exception):
            raise step
        return step


async def test_a_store_that_never_fetched_has_no_plan() -> None:
    store = PlanStore(fetcher=ScriptedFetcher([]))
    assert store.current is None


async def test_the_first_plan_always_counts_as_a_change(
    build_plan: Any,
) -> None:
    store = PlanStore(fetcher=ScriptedFetcher([build_plan()]))
    assert await store.refresh() is True
    assert store.current is not None


async def test_the_same_version_is_not_a_change(build_plan: Any) -> None:
    store = PlanStore(fetcher=ScriptedFetcher([build_plan(), build_plan()]))
    await store.refresh()
    assert await store.refresh() is False


async def test_a_new_version_is_a_change(build_plan: Any) -> None:
    store = PlanStore(
        fetcher=ScriptedFetcher([build_plan(), build_plan(version="v2")])
    )
    await store.refresh()
    assert await store.refresh() is True
    assert store.current is not None
    assert store.current.version == "v2"


async def test_a_failed_fetch_keeps_the_plan_that_is_already_running(
    build_plan: Any,
) -> None:
    store = PlanStore(
        fetcher=ScriptedFetcher([build_plan(), PlanUnavailable("拉不到")])
    )
    await store.refresh()
    assert await store.refresh() is False
    assert store.current is not None
    assert store.current.version == "v1"


async def test_failures_are_counted_until_one_succeeds(build_plan: Any) -> None:
    store = PlanStore(
        fetcher=ScriptedFetcher(
            [PlanUnavailable("一"), PlanUnavailable("二"), build_plan()]
        )
    )
    await store.refresh()
    await store.refresh()
    assert store.consecutive_failures == 2
    await store.refresh()
    assert store.consecutive_failures == 0


async def test_a_store_that_never_succeeded_stays_empty() -> None:
    store = PlanStore(fetcher=ScriptedFetcher([PlanUnavailable("拉不到")]))
    await store.refresh()
    assert store.current is None
