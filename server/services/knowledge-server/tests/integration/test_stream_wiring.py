"""知识库 worker 的 Redis 队列装配。"""

import uuid

import pytest

from knowledge_server.apps.knowledge.services.ingest_queue import (
    source_version_group,
)
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


@pytest.mark.parametrize("is_source_version", [False, True])
async def test_worker_cleans_acknowledged_ingest_messages(
    redis_settings: Settings, is_source_version: bool
) -> None:
    settings = redis_settings.model_copy(
        update={
            "app_role": ROLE_WORKER,
            "ingest_stream": f"test:knowledge:ingest:{uuid.uuid4()}",
        }
    )
    built = build_container(settings)
    assert isinstance(built.stream, RedisStream)
    regular = built.ingest_group()
    target = source_version_group(regular) if is_source_version else regular
    try:
        await built.stream.ensure_group(target)
        entry_id = await built.stream.publish(target.stream, {"kind": "ingest"})
        entries = await built.stream.read_group(target, count=1, block_ms=100)
        assert [entry.entry_id for entry in entries] == [entry_id]
        assert await built.stream.ack_if_owned(target, entry_id)
        assert await built.stream._client.xlen(target.stream) == 0
    finally:
        await built.cache.delete(target.stream)
        await built.stream.close()
        await built.cache.close()
        await built.platform.aclose()
        await built.database.dispose()
