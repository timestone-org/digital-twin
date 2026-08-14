"""端到端：整装进程起得来、探针回答得对、关停按顺序走完。

⚠ liveness 严禁查依赖，readiness 与「是不是 leader」无关（observability §5）：
热备副本没有任何会话，但它必须是就绪的，否则编排器会一直重启它。
"""

from collections.abc import AsyncIterator

import httpx
import pytest

from collector_server.app import build_app
from collector_server.settings import API_PREFIX, Settings

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
