"""本地 HTTP 多点位响应沿现有 Redis 快照、Stream 与 Timescale 归档管道运行。"""

import asyncio
import json
from collections.abc import Sequence
from urllib.parse import urlsplit
from uuid import uuid4

import pytest

from collector_server.apps.collect.drivers.base import DriverConnection
from collector_server.apps.collect.drivers.http.driver import HttpDriver
from collector_server.apps.collect.plan.adapt import specs_of
from collector_server.apps.collect.runtime.poller import PollLoop, PollOptions
from collector_server.apps.collect.runtime.session import (
    SessionOptions,
    SourceSession,
)
from collector_server.stream import stream_key
from collectwire import CollectPlan, PlanPoint, snapshot_key
from integration.http_pipeline_helpers import (
    BASE_MS,
    HttpPipeline,
    ManualClock,
    ObservedSink,
    ReadyReporter,
    http_pipeline,
    http_plan,
    local_http,
)
from lib.db import Database

pytestmark = [pytest.mark.requires_postgres, pytest.mark.requires_redis]


def _driver(plan: CollectPlan, clock: ManualClock) -> HttpDriver:
    source = plan.sources[0]
    url = urlsplit(source.endpoint)
    driver = HttpDriver(
        connection=DriverConnection(
            endpoint=source.endpoint,
            options=source.options,
            password=source.password,
            is_network_access_enabled=True,
            allowed_endpoints=frozenset({f"{url.scheme}://{url.netloc}"}),
        ),
        clock_ms=clock,
    )
    driver.load_points(specs_of(source))
    return driver


async def _record_round(
    driver: HttpDriver, pipeline: HttpPipeline, codes: Sequence[str]
) -> None:
    await PollLoop(
        driver=driver,
        sink=pipeline.sink,
        options=PollOptions(point_codes=tuple(codes), interval_ms=1000),
    ).tick()


def _many_points() -> tuple[PlanPoint, ...]:
    return (
        PlanPoint(
            point_code="temperature",
            address="/data/temperature",
            data_type="float",
            sampling_interval_ms=1000,
        ),
        PlanPoint(
            point_code="running",
            address="/data/running",
            data_type="bool",
            sampling_interval_ms=1000,
        ),
        PlanPoint(
            point_code="label",
            address="/data/labels/0",
            data_type="string",
            sampling_interval_ms=1000,
        ),
        PlanPoint(
            point_code="missing",
            address="/data/not_present",
            data_type="float",
            sampling_interval_ms=1000,
        ),
    )


async def _assert_snapshots(pipeline: HttpPipeline) -> None:
    raw = await pipeline.raw.hgetall(snapshot_key(pipeline.source_id))
    assert {code: json.loads(value) for code, value in raw.items()} == {
        "temperature": {"value": 21.5, "ts_ms": BASE_MS, "quality": "good"},
        "running": {"value": True, "ts_ms": BASE_MS, "quality": "good"},
        "label": {"value": "运行", "ts_ms": BASE_MS, "quality": "good"},
        "missing": {"value": None, "ts_ms": BASE_MS, "quality": "bad"},
    }


async def test_http_response_reaches_snapshot_stream_and_database(
    redis_url: str, database: Database
) -> None:
    payload = {
        "data": {"temperature": 21.5, "running": True, "labels": ["运行"]}
    }
    clock = ManualClock()
    async with local_http([payload]) as endpoint:
        plan = http_plan(uuid4(), endpoint.url, _many_points())
        driver = _driver(plan, clock)
        async with http_pipeline(redis_url, database, plan, clock) as pipeline:
            try:
                await driver.connect()
                await _record_round(
                    driver,
                    pipeline,
                    ["temperature", "running", "label", "missing"],
                )
                await pipeline.snapshots.flush_once()
                await pipeline.archives.flush_once()
                assert len(endpoint.requests) == 1
                await _assert_snapshots(pipeline)
                assert (
                    await pipeline.raw.ttl(snapshot_key(pipeline.source_id)) > 0
                )
                entries = await pipeline.archive_stream.read(
                    stream_key(pipeline.source_id), count=10
                )
                assert len(entries) == 1
                assert len(entries[0].rows) == 4
                await pipeline.writer.flush_once()
                assert await pipeline.stored() == [
                    ("label", "运行", "good"),
                    ("missing", None, "bad"),
                    ("running", 1.0, "good"),
                    ("temperature", 21.5, "good"),
                ]
                assert (
                    await pipeline.raw.xlen(stream_key(pipeline.source_id)) == 0
                )
            finally:
                await driver.disconnect()


@pytest.mark.parametrize(
    ("payloads", "policy", "expected"),
    [
        ([{"data": {"temperature": 20}}], {"archive_enabled": False}, []),
        (
            [{"data": {"temperature": value}} for value in (20, 20.5, 22)],
            {"deadband": 1},
            [(20.0, "good"), (22.0, "good")],
        ),
        (
            [{"data": {"temperature": 20}}] * 3,
            {"archive_max_interval_ms": 2000},
            [(20.0, "good"), (20.0, "good")],
        ),
        (
            [
                {"data": {"temperature": 20}},
                {"data": {}},
                {"data": {"temperature": 20}},
            ],
            {},
            [(20.0, "good"), (None, "bad"), (20.0, "good")],
        ),
    ],
    ids=["archive-disabled", "deadband", "heartbeat", "quality-change"],
)
async def test_http_samples_obey_the_same_archive_policy_as_other_drivers(
    redis_url: str,
    database: Database,
    payloads: Sequence[object],
    policy: dict[str, object],
    expected: list[tuple[float | None, str]],
) -> None:
    point = PlanPoint.model_validate(
        {
            "point_code": "temperature",
            "address": "/data/temperature",
            "data_type": "float",
            "sampling_interval_ms": 1000,
            **policy,
        }
    )
    clock = ManualClock()
    async with local_http(payloads) as endpoint:
        plan = http_plan(uuid4(), endpoint.url, (point,))
        driver = _driver(plan, clock)
        async with http_pipeline(redis_url, database, plan, clock) as pipeline:
            try:
                await driver.connect()
                for index in range(len(payloads)):
                    clock.now_ms = BASE_MS + index * 1000
                    await _record_round(driver, pipeline, ["temperature"])
                    await pipeline.flush()
                assert [
                    (value, quality)
                    for _, value, quality in await pipeline.stored()
                ] == expected
                raw = await pipeline.raw.hget(
                    snapshot_key(pipeline.source_id), "temperature"
                )
                assert raw is not None
                assert json.loads(raw)["ts_ms"] == clock.now_ms
                assert len(endpoint.requests) == len(payloads)
            finally:
                await driver.disconnect()


async def test_redelivered_http_archive_batch_is_stored_once(
    redis_url: str, database: Database
) -> None:
    point = PlanPoint(
        point_code="temperature",
        address="/value",
        data_type="float",
        sampling_interval_ms=1000,
    )
    clock = ManualClock()
    async with local_http([{"value": 21.5}]) as endpoint:
        plan = http_plan(uuid4(), endpoint.url, (point,))
        driver = _driver(plan, clock)
        async with http_pipeline(redis_url, database, plan, clock) as pipeline:
            try:
                await driver.connect()
                await _record_round(driver, pipeline, ["temperature"])
                await pipeline.archives.flush_once()
                entries = await pipeline.archive_stream.read(
                    stream_key(pipeline.source_id), count=10
                )
                await pipeline.archive_stream.append(
                    pipeline.source_id, entries[0].rows, maxlen=1000
                )
                await pipeline.writer.flush_once()
                assert await pipeline.stored() == [
                    ("temperature", 21.5, "good")
                ]
                assert (
                    await pipeline.raw.xlen(stream_key(pipeline.source_id)) == 0
                )
            finally:
                await driver.disconnect()


async def test_http_source_session_runs_through_the_existing_poller(
    redis_url: str, database: Database
) -> None:
    point = PlanPoint(
        point_code="temperature",
        address="/value",
        data_type="float",
        sampling_interval_ms=1000,
    )
    clock = ManualClock()
    async with local_http([{"value": 21.5}]) as endpoint:
        plan = http_plan(uuid4(), endpoint.url, (point,))
        async with http_pipeline(redis_url, database, plan, clock) as pipeline:
            reporter = ReadyReporter()
            observed = ObservedSink(pipeline.sink)
            session = SourceSession(
                source=plan.sources[0],
                driver=_driver(plan, clock),
                sink=observed,
                options=SessionOptions(
                    heartbeat_interval_s=60, max_backoff_s=60
                ),
                reporter=reporter,
            )
            task = asyncio.create_task(session.run())
            try:
                await asyncio.wait_for(reporter.ready.wait(), timeout=5)
                await asyncio.wait_for(observed.sampled.wait(), timeout=5)
            finally:
                await session.stop()
                await asyncio.wait_for(task, timeout=5)
            await pipeline.flush()
            assert await pipeline.stored() == [("temperature", 21.5, "good")]
            assert len(endpoint.requests) == 1
            assert session.is_online is False
