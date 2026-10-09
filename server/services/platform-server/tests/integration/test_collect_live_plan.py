"""采集配置页用分批游标读取全部点位身份，顺序按编码固定。"""

import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unit.publish_fakes import (
    FakeRealtime,
    FakeSnapshotSource,
    FakeViewerSource,
    subscription_row,
)

from integration.collect_helpers import create_points, create_source, point_item
from integration.dashboard_publish_fixtures import SessionDatabase
from platform_server.apps.collect.models import CollectPoint
from platform_server.apps.collect.services.live_plan import (
    DatabaseLivePlanSource,
)
from platform_server.apps.collect.services.live_publisher import (
    LiveOptions,
    SourceLivePublisher,
)
from platform_server.apps.collect.services.snapshot_source import PointReading
from platform_server.apps.collect.services.topic_reconcile import (
    DatabaseSourceIndex,
)
from platform_server.apps.collect.services.topics import topic_of
from platform_server.apps.collect.services.watchers import SubscriptionWatchers

pytestmark = pytest.mark.requires_postgres

BATCH_SIZE = 10
NOW_MS = 1_700_000_000_000


async def test_the_points_come_back_as_node_keys(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"], point_item("outlet_temp"))
    plans = DatabaseLivePlanSource(database=SessionDatabase(db_session))

    plan = await plans.load(uuid.UUID(source["id"]), batch_size=BATCH_SIZE)

    assert plan is not None
    assert plan.node_keys == (f"{source['id']}:outlet_temp",)


async def test_the_order_is_by_code_and_does_not_wobble(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    source = await create_source(app_client)
    await create_points(
        app_client,
        source["id"],
        point_item("zeta"),
        point_item("alpha"),
        point_item("mid"),
    )
    plans = DatabaseLivePlanSource(database=SessionDatabase(db_session))

    plan = await plans.load(uuid.UUID(source["id"]), batch_size=BATCH_SIZE)

    assert plan is not None
    assert [key.split(":", 1)[1] for key in plan.node_keys] == [
        "alpha",
        "mid",
        "zeta",
    ]


async def test_a_source_exactly_matching_the_batch_size_is_complete(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"], point_item("a"))
    plans = DatabaseLivePlanSource(database=SessionDatabase(db_session))

    plan = await plans.load(uuid.UUID(source["id"]), batch_size=1)

    assert plan is not None
    assert plan.node_keys == (f"{source['id']}:a",)


async def test_a_batch_size_does_not_truncate_the_point_list(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    source = await create_source(app_client)
    await create_points(
        app_client, source["id"], point_item("a"), point_item("b")
    )
    plans = DatabaseLivePlanSource(database=SessionDatabase(db_session))

    plan = await plans.load(uuid.UUID(source["id"]), batch_size=1)

    assert plan is not None
    assert plan.node_keys == (f"{source['id']}:a", f"{source['id']}:b")


async def test_a_source_without_points_yields_an_empty_plan(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    source = await create_source(app_client)
    plans = DatabaseLivePlanSource(database=SessionDatabase(db_session))

    plan = await plans.load(uuid.UUID(source["id"]), batch_size=BATCH_SIZE)

    assert plan is not None
    assert plan.node_keys == ()


async def test_a_missing_source_yields_no_plan_at_all(
    db_session: AsyncSession,
) -> None:
    # 数据源没了与「它下面没有点位」是两件事：前者要连主题一起注销
    plans = DatabaseLivePlanSource(database=SessionDatabase(db_session))

    assert await plans.load(uuid.uuid4(), batch_size=BATCH_SIZE) is None


async def test_every_source_is_in_the_reconcile_index(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    # ⚠ 不按 is_enabled 过滤：停用的源照样要能打开配置页看它「为什么没有值」，
    # 而主题未登记时 hub 一律拒订
    enabled = await create_source(app_client)
    disabled = await create_source(app_client, code="line-2", is_enabled=False)
    index = DatabaseSourceIndex(database=SessionDatabase(db_session))

    found = await index.live_ids()

    assert {uuid.UUID(enabled["id"]), uuid.UUID(disabled["id"])} <= set(found)


async def seed_large_source(
    session: AsyncSession, source_id: uuid.UUID
) -> tuple[str, ...]:
    """给回滚事务种下 1119 个点位，返回编码升序的身份。

    Args: session, source_id。
    """
    codes = tuple(f"point-{index:04d}" for index in range(1119))
    session.add_all(
        CollectPoint(
            source_id=source_id,
            code=code,
            name=code,
            address=f"ns=2;s={code}",
            data_type="float",
            sampling_interval_ms=1000,
            deadband=0,
            archive_enabled=True,
            archive_max_interval_ms=60_000,
        )
        for code in reversed(codes)
    )
    await session.flush()
    return tuple(f"{source_id}:{code}" for code in codes)


async def test_a_large_source_is_fully_published_in_bounded_batches(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    source_id = uuid.UUID((await create_source(app_client))["id"])
    node_keys = await seed_large_source(db_session, source_id)
    snapshots = FakeSnapshotSource(
        readings={
            key: PointReading(value=1.0, timestamp_ms=NOW_MS, quality="good")
            for key in node_keys
        }
    )
    viewers = FakeViewerSource(
        rows=[
            subscription_row(
                topic_of(source_id), uuid.uuid5(source_id, "viewer")
            )
        ]
    )
    realtime = FakeRealtime()
    publisher = SourceLivePublisher(
        plans=DatabaseLivePlanSource(database=SessionDatabase(db_session)),
        watchers=SubscriptionWatchers(source=viewers),
        snapshots=snapshots,
        realtime=realtime,
        options=LiveOptions(max_items=200, batch_points=1000, plan_ttl_s=10.0),
        ticker=lambda: 0.0,
    )

    report = await publisher.publish_once()

    assert report.items == 1119
    assert [len(batch) for batch in snapshots.asked] == [1000, 119]
    assert tuple(len(items) for _, items, _ in realtime.published) == (
        200,
        200,
        200,
        200,
        200,
        119,
    )
    assert realtime.published[-1][1][-1]["nodeKey"] == node_keys[-1]
    for key, value in ((node_keys[1000], 2.0), (node_keys[-1], 3.0)):
        snapshots.readings[key] = PointReading(
            value=value, timestamp_ms=NOW_MS, quality="good"
        )
    await publisher.publish_once()
    assert [item["nodeKey"] for item in realtime.published[-1][1]] == [
        node_keys[1000],
        node_keys[-1],
    ]


async def test_read_batches_must_have_a_positive_size(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    source = await create_source(app_client)
    plans = DatabaseLivePlanSource(database=SessionDatabase(db_session))

    with pytest.raises(ValueError, match="批大小必须大于零"):
        await plans.load(uuid.UUID(source["id"]), batch_size=0)
