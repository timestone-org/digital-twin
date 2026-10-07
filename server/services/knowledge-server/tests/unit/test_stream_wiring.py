"""摄取队列按运行角色装配读取预算。"""

import pytest

from knowledge_server import container
from knowledge_server.container import build_container
from knowledge_server.settings import ROLE_API, ROLE_WORKER, Settings
from lib.cache import Cache
from lib.stream import RedisStream


@pytest.fixture
def budgets(monkeypatch: pytest.MonkeyPatch) -> dict[str, float]:
    observed: dict[str, float] = {}

    def stream(*, url: str, timeout_s: float) -> RedisStream:
        observed["stream"] = timeout_s
        return RedisStream(url=url, timeout_s=timeout_s)

    def cache(*, url: str, timeout_s: float) -> Cache:
        observed["cache"] = timeout_s
        return Cache(url=url, timeout_s=timeout_s)

    monkeypatch.setattr(container, "RedisStream", stream)
    monkeypatch.setattr(container, "Cache", cache)
    return observed


@pytest.mark.parametrize(
    "budget",
    [
        (ROLE_API, 1.0, 5_000, 1.0),
        (ROLE_WORKER, 1.0, 5_000, 7.0),
        (ROLE_WORKER, 1.0, 10_000, 12.0),
        (ROLE_WORKER, 20.0, 5_000, 20.0),
    ],
)
async def test_stream_budget_covers_only_worker_blocking_reads(
    settings: Settings,
    budgets: dict[str, float],
    budget: tuple[str, float, int, float],
) -> None:
    role, redis_timeout_s, block_ms, expected_timeout_s = budget
    configured = settings.model_copy(
        update={
            "app_role": role,
            "redis_timeout_s": redis_timeout_s,
            "ingest_block_ms": block_ms,
        }
    )
    built = build_container(configured)
    try:
        assert budgets == {
            "stream": expected_timeout_s,
            "cache": redis_timeout_s,
        }
    finally:
        await built.stream.close()
        await built.cache.close()
        await built.platform.aclose()
        await built.database.dispose()
