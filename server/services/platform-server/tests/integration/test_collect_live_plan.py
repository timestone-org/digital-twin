"""采集配置页要推哪些点位，打真库。

⚠ 两条口径只有打真库才守得住：清单必须按 `code` 升序（顺序不定就等于「每次
重读换一批点位有实时值」），以及截断标记必须诚实（静默截断会让超出的那些行
看起来像坏了）。
"""

import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.collect_helpers import create_points, create_source, point_item
from integration.dashboard_publish_fixtures import SessionDatabase
from platform_server.apps.collect.services.live_plan import (
    DatabaseLivePlanSource,
)
from platform_server.apps.collect.services.topic_reconcile import (
    DatabaseSourceIndex,
)

pytestmark = pytest.mark.requires_postgres

LIMIT = 10


async def test_the_points_come_back_as_node_keys(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"], point_item("outlet_temp"))
    plans = DatabaseLivePlanSource(database=SessionDatabase(db_session))

    plan = await plans.load(uuid.UUID(source["id"]), limit=LIMIT)

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

    plan = await plans.load(uuid.UUID(source["id"]), limit=LIMIT)

    assert plan is not None
    assert [key.split(":", 1)[1] for key in plan.node_keys] == [
        "alpha",
        "mid",
        "zeta",
    ]


async def test_an_untruncated_list_says_so(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"], point_item("a"))
    plans = DatabaseLivePlanSource(database=SessionDatabase(db_session))

    plan = await plans.load(uuid.UUID(source["id"]), limit=LIMIT)

    assert plan is not None
    assert plan.is_truncated is False


async def test_a_truncated_list_says_so_and_stops_at_the_limit(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    # ⚠ 静默截断是坑：超出的那些点位照常采集与归档，只是没有实时值
    source = await create_source(app_client)
    await create_points(
        app_client, source["id"], point_item("a"), point_item("b")
    )
    plans = DatabaseLivePlanSource(database=SessionDatabase(db_session))

    plan = await plans.load(uuid.UUID(source["id"]), limit=1)

    assert plan is not None
    assert (len(plan.node_keys), plan.is_truncated) == (1, True)


async def test_a_source_without_points_yields_an_empty_plan(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    source = await create_source(app_client)
    plans = DatabaseLivePlanSource(database=SessionDatabase(db_session))

    plan = await plans.load(uuid.UUID(source["id"]), limit=LIMIT)

    assert plan is not None
    assert plan.node_keys == ()


async def test_a_missing_source_yields_no_plan_at_all(
    db_session: AsyncSession,
) -> None:
    # 数据源没了与「它下面没有点位」是两件事：前者要连主题一起注销
    plans = DatabaseLivePlanSource(database=SessionDatabase(db_session))

    assert await plans.load(uuid.uuid4(), limit=LIMIT) is None


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
