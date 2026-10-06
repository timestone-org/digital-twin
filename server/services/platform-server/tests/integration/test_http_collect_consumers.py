"""HTTP 点位复用大屏快照、历史查询、台账、报告及分析取数口径。"""

import json
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta

import pytest
from conftest import AppContext
from redis.asyncio import Redis
from unit.publish_fakes import (
    FakeRealtime,
    FakeViewerSource,
    subscription_row,
)

from collectwire import snapshot_key
from integration.collector_helpers import (
    CLOSED,
    NOW,
    aggregate_table,
    rows_of,
    run_pass,
)
from integration.dashboard_publish_fixtures import (
    SessionDatabase,
    load_one,
    make_twin_node,
)
from integration.dataset_helpers import (
    ArchiveWriter,
    Sample,
    create_column,
    data_of,
)
from integration.http_consumer_helpers import (
    HttpPoints,
    build_http_points,
)
from lib.web import CursorParams
from platform_server.apps.collect.services import (
    DatabasePointCatalog,
    ReadOnlyHistorySource,
    history_service,
)
from platform_server.apps.collect.services.snapshot_source import (
    RedisSnapshotSource,
)
from platform_server.apps.dashboard.schemas import BindingCreateIn
from platform_server.apps.dashboard.services import ValidationContext
from platform_server.apps.dashboard.services.binding_service import (
    create_binding,
)
from platform_server.apps.dashboard.services.module_catalog import (
    load_module_catalog,
)
from platform_server.apps.dashboard.services.publish_plan import (
    DatabasePlanSource,
)
from platform_server.apps.dashboard.services.publish_service import (
    DashboardPublisher,
    PublishOptions,
)
from platform_server.apps.dashboard.services.topics import topic_of
from platform_server.apps.dashboard.services.viewers import SubscriptionViewers
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog
from platform_server.apps.modeling.services.frame_source import (
    SourceRequest,
    load_frame,
)

pytestmark = pytest.mark.requires_postgres


@pytest.fixture
async def http_points(
    app_context: AppContext, archive: ArchiveWriter
) -> AsyncIterator[HttpPoints]:
    async with build_http_points(app_context, archive) as points:
        yield points


async def _bind_http_points(
    context: AppContext, points: HttpPoints
) -> uuid.UUID:
    dashboard_id, node_id = await make_twin_node(context.client)
    validation = ValidationContext(
        catalog=load_module_catalog(),
        points=DatabasePointCatalog(sessions=context.sessions),
    )
    for index, kind in enumerate(("opcua", "archive")):
        await create_binding(
            context.session,
            node_id=uuid.UUID(node_id),
            payload=BindingCreateIn(
                field_key=f"anchorValues[{index}].value",
                source_kind=kind,
                node_key=points.temperature_key,
                detail_json=(
                    {
                        "node_key": points.temperature_key,
                        "range": {"last_window": "1h"},
                    }
                    if kind == "archive"
                    else None
                ),
            ),
            context=validation,
        )
    await context.session.commit()
    return uuid.UUID(dashboard_id)


def _publisher(
    context: AppContext,
    dashboard_id: uuid.UUID,
    snapshots: RedisSnapshotSource,
    realtime: FakeRealtime,
) -> DashboardPublisher:
    return DashboardPublisher(
        plans=DatabasePlanSource(database=SessionDatabase(context.session)),
        viewers=SubscriptionViewers(
            source=FakeViewerSource(
                rows=[subscription_row(topic_of(dashboard_id), uuid.uuid4())]
            )
        ),
        snapshots=snapshots,
        realtime=realtime,
        options=PublishOptions(max_items=100),
    )


async def test_http_point_uses_the_existing_dashboard_snapshot_publisher(
    app_context: AppContext, http_points: HttpPoints, redis_url: str
) -> None:
    dashboard_id = await _bind_http_points(app_context, http_points)
    plans = DatabasePlanSource(database=SessionDatabase(app_context.session))
    lookup = await load_one(plans, dashboard_id)
    assert lookup.plan is not None
    assert lookup.plan.node_keys == (http_points.temperature_key,)
    snapshots = RedisSnapshotSource(url=redis_url, timeout_s=2)
    raw = Redis.from_url(redis_url, decode_responses=True)
    ts_ms = int(CLOSED.timestamp() * 1000)
    await raw.hset(
        snapshot_key(http_points.source_id),
        mapping={
            "temperature": json.dumps(
                {"value": 21.5, "ts_ms": ts_ms, "quality": "good"}
            )
        },
    )
    realtime = FakeRealtime()
    try:
        report = await _publisher(
            app_context, dashboard_id, snapshots, realtime
        ).publish_once()
        assert report.items == 1
        assert realtime.published[0][0] == topic_of(dashboard_id)
        assert realtime.published[0][1][0] == {
            "nodeKey": http_points.temperature_key,
            "state": "ok",
            "value": 21.5,
            "timestampMs": ts_ms,
            "quality": "good",
        }
    finally:
        await raw.delete(snapshot_key(http_points.source_id))
        await raw.aclose()
        await snapshots.close()


async def test_http_point_history_is_read_by_the_shared_archive_provider(
    http_points: HttpPoints, history_source: ReadOnlyHistorySource
) -> None:
    await http_points.archive.write(
        "temperature",
        [
            Sample(ts=CLOSED + timedelta(minutes=5), value_num=21.5),
            Sample(ts=CLOSED + timedelta(minutes=25), value_num=31.5),
        ],
    )
    page = await history_service.read_history(
        history_source,
        query=history_service.build_query(
            node_keys=[http_points.temperature_key],
            range_start=CLOSED,
            range_end=CLOSED + timedelta(hours=1),
        ),
        page=CursorParams(50, None),
    )
    assert [item.value for item in page.items] == [21.5, 31.5]
    assert [item.node_key for item in page.items] == [
        http_points.temperature_key,
        http_points.temperature_key,
    ]


async def _http_ledger(
    context: AppContext, points: HttpPoints, dirty: DatasetDirtyLog
) -> tuple[str, str]:
    table = await aggregate_table(context.client, code="http_measurements")
    await create_column(
        context.client,
        table["id"],
        key="mean_temperature",
        name="接口平均温度",
        source="point",
        node_key=points.temperature_key,
        agg="avg",
    )
    await points.archive.write(
        "temperature",
        [
            Sample(ts=CLOSED + timedelta(minutes=5), value_num=21.5),
            Sample(ts=CLOSED + timedelta(minutes=25), value_num=31.5),
        ],
    )
    outcome = await run_pass(
        context, (dirty, points.archive), table_id=table["id"]
    )
    assert outcome is not None
    assert outcome.written == 1
    return str(table["id"]), str(table["code"])


async def _report_value(context: AppContext, table_code: str) -> str:
    report = await context.client.post(
        "/api/v1/platform/report-templates",
        json={
            "code": "http_report",
            "name": "HTTP 数据报告",
            "metrics": [
                {
                    "name": "接口温度",
                    "table": table_code,
                    "key": "mean_temperature",
                    "mode": "window_agg",
                    "agg": "avg",
                }
            ],
        },
    )
    assert report.status_code == 201, report.text
    preview = await context.client.post(
        f"/api/v1/platform/report-templates/{data_of(report)['id']}:preview",
        json={"period": "2026-08"},
    )
    assert preview.status_code == 200, preview.text
    assert data_of(preview)["warnings"] == []
    return str(data_of(preview)["metrics"][0]["value"])


async def test_http_archive_reaches_ledger_report_and_modeling(
    app_context: AppContext, http_points: HttpPoints, dirty: DatasetDirtyLog
) -> None:
    table_id, table_code = await _http_ledger(app_context, http_points, dirty)
    rows = await rows_of(app_context.client, table_id)
    assert rows[0]["values"]["mean_temperature"] == 26.5
    assert rows[0]["samples"]["mean_temperature"] == 2
    assert await _report_value(app_context, table_code) == "26.5"
    frame = await load_frame(
        app_context.session,
        request=SourceRequest(
            table_code=table_code,
            columns=("mean_temperature",),
            since=CLOSED.isoformat(),
            until=NOW.isoformat(),
            row_source="collect",
            row_limit=100,
        ),
        now=NOW,
    )
    assert frame.rows == ((26.5,),)
    assert frame.index == (int(CLOSED.timestamp() * 1000),)
    assert frame.provenance.is_truncated is False
