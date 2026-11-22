"""摄取队列按运行角色装配读取预算与确认策略。"""

import pytest

from knowledge_server import container
from knowledge_server.container import build_container
from knowledge_server.settings import ROLE_API, ROLE_WORKER, Settings
from lib.cache import Cache
from lib.stream import RedisStream


@pytest.fixture
def redis_options(monkeypatch: pytest.MonkeyPatch) -> dict[str, float | bool]:
    observed: dict[str, float | bool] = {}

    def stream(
        *, url: str, timeout_s: float, should_delete_on_ack: bool
    ) -> RedisStream:
        observed["stream"] = timeout_s
        observed["should_delete_on_ack"] = should_delete_on_ack
        return RedisStream(
            url=url,
            timeout_s=timeout_s,
            should_delete_on_ack=should_delete_on_ack,
        )

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
async def test_stream_wiring_uses_role_specific_budget_and_ack_policy(
    settings: Settings,
    redis_options: dict[str, float | bool],
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
        assert redis_options == {
            "stream": expected_timeout_s,
            "cache": redis_timeout_s,
            "should_delete_on_ack": role == ROLE_WORKER,
        }
    finally:
        await built.stream.close()
        await built.cache.close()
        await built.platform.aclose()
        await built.database.dispose()
