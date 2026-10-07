"""真实 Redis 空队列按阻塞时长返回，不误报依赖故障。"""

import uuid

import pytest

from knowledge_server.container import build_container
from knowledge_server.settings import ROLE_WORKER, Settings
from lib.stream import RedisStream

pytestmark = pytest.mark.requires_redis


async def test_worker_can_wait_for_an_empty_ingest_queue(
    redis_settings: Settings,
) -> None:
    settings = redis_settings.model_copy(
        update={
            "app_role": ROLE_WORKER,
            "redis_timeout_s": 1.0,
            "ingest_block_ms": 5_000,
            "ingest_stream": f"test:knowledge:ingest:{uuid.uuid4()}",
        }
    )
    built = build_container(settings)
    assert isinstance(built.stream, RedisStream)
    target = built.ingest_group()
    try:
        await built.stream.ensure_group(target)
        entries = await built.stream.read_group(
            target,
            count=settings.ingest_batch,
            block_ms=settings.ingest_block_ms,
        )
        assert entries == []
    finally:
        await built.cache.delete(target.stream)
        await built.stream.close()
        await built.cache.close()
        await built.platform.aclose()
        await built.database.dispose()
