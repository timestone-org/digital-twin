"""平台作业流确认后回收已处理条目。"""

import uuid

import pytest

from lib.stream import StreamGroup
from platform_server.container import _build_stream
from platform_server.settings import Settings


@pytest.mark.usefixtures("redis_url")
async def test_job_stream_deletes_an_acknowledged_entry(
    settings: Settings,
) -> None:
    stream = _build_stream(settings)
    target = StreamGroup(
        f"test:platform:job:{uuid.uuid4()}", settings.modeling_group, "worker"
    )
    try:
        await stream.ensure_group(target)
        entry_id = await stream.publish(target.stream, {"task_id": "example"})
        entries = await stream.read_group(target, count=1, block_ms=10)
        assert [entry.entry_id for entry in entries] == [entry_id]
        await stream.ack(target, entry_id)
        assert await stream._client.xlen(target.stream) == 0
    finally:
        await stream._client.delete(target.stream)
        await stream.close()
