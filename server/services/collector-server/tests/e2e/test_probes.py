"""端到端：整装进程起得来、探针回答得对、关停按顺序走完。

⚠ liveness 严禁查依赖，readiness 与「是不是 leader」无关（observability §5）：
热备副本没有任何会话，但它必须是就绪的，否则编排器会一直重启它。
"""

import asyncio
from collections.abc import AsyncIterator

import httpx
import pytest

from collector_server.app import build_app
from collector_server.apps.collect.plan.client import PlanClient
from collector_server.container import Container
from collector_server.settings import API_PREFIX, Settings
from collectwire import CollectPlan
from lib.cache import PubSub

pytestmark = [
    pytest.mark.requires_postgres,
    pytest.mark.requires_redis,
]


@pytest.fixture
async def client(
    live_settings: Settings, redis_url: str, database: object
) -> AsyncIterator[httpx.AsyncClient]:
    """跑完整生命周期的客户端。

    ⚠ platform 在这条用例里是不可达的：正好验一遍「拿不到计划照样起得来，
    只是空转」这条降级方向。

    Args: live_settings, redis_url, database。
    """
    # 这两个依赖只为「连不上就跳过」，取一下让意图显式
    assert redis_url
    assert database is not None
    app = build_app(live_settings)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://collector-test", timeout=30
        ) as opened:
            yield opened


async def test_liveness_answers_without_touching_any_dependency(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get(f"{API_PREFIX}/health")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


async def test_readiness_reports_ready_even_without_a_plan(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get(f"{API_PREFIX}/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"


async def test_the_service_exposes_no_business_routes(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get(f"{API_PREFIX}/collect-sources")
    assert response.status_code == 404


@pytest.mark.usefixtures("database")
async def test_plan_change_notification_refreshes_before_periodic_poll(
    live_settings: Settings,
    redis_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    version = "initial"
    fetched = asyncio.Queue[str]()

    async def fetch(_: PlanClient) -> CollectPlan:
        fetched.put_nowait(version)
        return CollectPlan(version=version, sources=())

    monkeypatch.setattr(PlanClient, "fetch", fetch)
    settings = live_settings.model_copy(update={"plan_refresh_interval_s": 60})
    app = build_app(settings)
    container: Container = app.state.container
    pubsub = PubSub(url=redis_url)
    try:
        async with app.router.lifespan_context(app), asyncio.timeout(2):
            assert await fetched.get() == "initial"
            assert await fetched.get() == "initial"
            version = "updated"
            topic = "collect:plan:changed"
            for _ in range(100):
                if await pubsub.publish(topic, {"kind": "plan_changed"}):
                    break
                await asyncio.sleep(0.01)
            else:
                pytest.fail("采集进程未订阅计划变更频道")
            assert await fetched.get() == "updated"
            assert container.plan.current is not None
            assert container.plan.current.version == "updated"
    finally:
        await pubsub.close()
