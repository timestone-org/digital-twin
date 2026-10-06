"""HTTP 点位的配置、真归档与下游消费测试夹具。"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from conftest import AppContext

from integration.collect_helpers import create_points, create_source, point_item
from integration.dataset_helpers import ArchiveWriter


@dataclass(frozen=True)
class HttpPoints:
    source_id: uuid.UUID
    temperature_key: str
    running_key: str
    archive: ArchiveWriter


@asynccontextmanager
async def build_http_points(
    app_context: AppContext, archive: ArchiveWriter
) -> AsyncIterator[HttpPoints]:
    source = await create_source(
        app_context.client,
        protocol="http",
        endpoint="https://example.test/measurements",
        read_mode="poll",
        options_json={"method": "GET", "auth_type": "none"},
    )
    source_id = uuid.UUID(str(source["id"]))
    points = await create_points(
        app_context.client,
        str(source_id),
        point_item("temperature", address="/data/temperature"),
        point_item(
            "running", address="/data/running", data_type="bool", unit=None
        ),
    )
    writer = ArchiveWriter(database=archive.database, source_id=source_id)
    try:
        yield HttpPoints(
            source_id=source_id,
            temperature_key=str(points["items"][0]["node_key"]),
            running_key=str(points["items"][1]["node_key"]),
            archive=writer,
        )
    finally:
        await writer.clear()
