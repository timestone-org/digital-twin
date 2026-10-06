"""本地 HTTP 端点与真实 Redis、Timescale 采集管道夹具。"""

import asyncio
import json
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from uuid import UUID

from redis.asyncio import Redis
from sqlalchemy import text

from collector_server.apps.collect.archive.buffer import (
    ArchiveBuffer,
    ArchiveOptions,
)
from collector_server.apps.collect.archive.writer import (
    ArchiveWriter,
    WriterOptions,
)
from collector_server.apps.collect.drivers.base import ValueSink
from collector_server.apps.collect.runtime.session import SourceStatus
from collector_server.apps.collect.runtime.sink import SnapshotSink, fan_out
from collector_server.apps.collect.services import PointHistoryService
from collector_server.clock import Clock
from collector_server.snapshot import RedisSnapshotStore
from collector_server.stream import RedisArchiveStream, stream_key
from collectwire import CollectPlan, PlanPoint, PlanSource, snapshot_key
from lib.db import Database
from timeseries import Quality, read_value

TOKEN = "http-test-token"
BASE_MS = 1_787_544_300_000


@dataclass
class ManualClock:
    now_ms: int = BASE_MS

    def __call__(self) -> int:
        return self.now_ms


@dataclass(frozen=True)
class Request:
    method: str
    target: str
    headers: dict[str, str]


@dataclass
class HttpEndpoint:
    payloads: Sequence[object]
    url: str = ""
    requests: list[Request] = field(default_factory=list[Request])

    async def handle(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            raw = await reader.readuntil(b"\r\n\r\n")
            lines = raw.decode("ascii").split("\r\n")
            method, target, _ = lines[0].split(" ")
            headers = {
                name.lower(): value.strip()
                for line in lines[1:]
                if ":" in line
                for name, value in [line.split(":", maxsplit=1)]
            }
            request = Request(method=method, target=target, headers=headers)
            self.requests.append(request)
            is_authorized = headers.get("authorization") == f"Bearer {TOKEN}"
            payload = self.payloads[
                min(len(self.requests) - 1, len(self.payloads) - 1)
            ]
            body = json.dumps(payload).encode("utf-8")
            status = "200 OK" if is_authorized else "401 Unauthorized"
            response = (
                f"HTTP/1.1 {status}\r\nContent-Type: application/json\r\n"
                f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n"
            ).encode("ascii")
            writer.write(response + body)
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()


@asynccontextmanager
async def local_http(payloads: Sequence[object]) -> AsyncIterator[HttpEndpoint]:
    endpoint = HttpEndpoint(payloads=payloads)
    server = await asyncio.start_server(endpoint.handle, "127.0.0.1", 0)
    endpoint.url = (
        f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}/measurements"
    )
    async with server:
        yield endpoint


@dataclass(frozen=True)
class StaticPlan:
    current: CollectPlan


@dataclass
class ReadyReporter:
    ready: asyncio.Event = field(default_factory=asyncio.Event)

    async def report(self, status: SourceStatus) -> None:
        if status.state == "online":
            self.ready.set()


@dataclass
class ObservedSink:
    sink: ValueSink
    sampled: asyncio.Event = field(default_factory=asyncio.Event)

    def __call__(
        self, code: str, value: object, ts_ms: int, quality: Quality
    ) -> None:
        self.sink(code, value, ts_ms, quality)
        self.sampled.set()


def http_plan(
    source_id: UUID, url: str, points: tuple[PlanPoint, ...]
) -> CollectPlan:
    return CollectPlan(
        version="http-loopback",
        sources=(
            PlanSource(
                source_id=source_id,
                code="http-loopback",
                protocol="http",
                endpoint=url,
                options={"auth_type": "bearer"},
                password=TOKEN,
                read_mode="poll",
                points=points,
            ),
        ),
    )


@dataclass(frozen=True)
class HttpPipeline:
    source_id: UUID
    database: Database
    raw: Redis
    snapshots: SnapshotSink
    archives: ArchiveBuffer
    writer: ArchiveWriter
    snapshot_store: RedisSnapshotStore
    archive_stream: RedisArchiveStream

    @property
    def sink(self) -> ValueSink:
        return fan_out(
            self.snapshots.sink_for(self.source_id),
            self.archives.sink_for(self.source_id),
        )

    async def flush(self) -> None:
        await self.snapshots.flush_once()
        await self.archives.flush_once()
        await self.writer.flush_once()

    async def stored(self) -> list[tuple[str, object, str]]:
        async with self.database.session() as session:
            result = await session.execute(
                text(
                    "SELECT point_code, value_num, value_text, quality "
                    "FROM collect.point_history WHERE source_id = :source_id "
                    "ORDER BY ts, point_code"
                ),
                {"source_id": self.source_id},
            )
            return [
                (str(row[0]), read_value(row[1], row[2]), str(row[3]))
                for row in result.all()
            ]

    async def close(self) -> None:
        await self.raw.delete(
            snapshot_key(self.source_id), stream_key(self.source_id)
        )
        await self.raw.aclose()
        await self.snapshot_store.close()
        await self.archive_stream.close()
        async with self.database.session() as session:
            await session.execute(
                text(
                    "DELETE FROM collect.point_history "
                    "WHERE source_id = :source_id"
                ),
                {"source_id": self.source_id},
            )


@asynccontextmanager
async def http_pipeline(
    redis_url: str, database: Database, plan: CollectPlan, clock: Clock
) -> AsyncIterator[HttpPipeline]:
    snapshot_store = RedisSnapshotStore(url=redis_url)
    stream = RedisArchiveStream(url=redis_url)
    view = StaticPlan(current=plan)
    archives = ArchiveBuffer(
        stream=stream,
        plan=view,
        clock=clock,
        options=ArchiveOptions(
            flush_interval_ms=60_000,
            max_rows=100,
            batch_rows=10,
            stream_maxlen=1000,
        ),
    )
    pipeline = HttpPipeline(
        source_id=plan.sources[0].source_id,
        database=database,
        raw=Redis.from_url(redis_url, decode_responses=True),
        snapshots=SnapshotSink(
            store=snapshot_store, interval_ms=300, ttl_s=60, plan=view
        ),
        archives=archives,
        writer=ArchiveWriter(
            stream=stream,
            store=PointHistoryService(database=database, batch_rows=10),
            options=WriterOptions(flush_interval_ms=60_000),
        ),
        snapshot_store=snapshot_store,
        archive_stream=stream,
    )
    await archives.flush_once()
    try:
        yield pipeline
    finally:
        await pipeline.close()
