"""点位状态在分页之前筛选，异常查询覆盖全部配置点位。"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

import httpx
import pytest
from conftest import CollectFakes
from sqlalchemy.ext.asyncio import AsyncSession
from unit.collect_fakes import FakeHistorySource
from unit.publish_fakes import FakeSnapshotSource

from integration.collect_helpers import (
    POINTS,
    create_points,
    create_source,
    payload,
    point_item,
)
from lib.errors import DependencyUnavailable
from lib.web import PageParams
from platform_server.apps.collect.errors import HistoryUnavailable
from platform_server.apps.collect.services.point_query import (
    PointFilters,
    PointQueryContext,
    list_points,
)
from platform_server.apps.collect.services.snapshot_source import (
    PointReading,
    RedisSnapshotSource,
)
from platform_server.apps.collect.services.state_source import SourceStateSource

pytestmark = pytest.mark.requires_postgres


@pytest.fixture
def snapshots(monkeypatch: pytest.MonkeyPatch) -> FakeSnapshotSource:
    """替换快照 IO，保留真实路由与数据库查询。Args: monkeypatch。"""
    fake = FakeSnapshotSource()

    async def read(
        _self: RedisSnapshotSource, node_keys: Sequence[str]
    ) -> dict[str, PointReading]:
        return await fake.read(node_keys)

    monkeypatch.setattr(RedisSnapshotSource, "read", read)
    return fake


def online(collect_fakes: CollectFakes, source_id: str) -> None:
    """让采集运行态读侧报告源在线。Args: collect_fakes, source_id。"""
    collect_fakes.history.rows.append(
        {
            "source_id": source_id,
            "state": "online",
            "point_count": 2,
            "error_category": None,
            "error_detail": None,
            "leader_instance": "collector-test",
            "updated_at": None,
        }
    )


async def test_abnormal_filter_finds_points_beyond_the_unfiltered_first_page(
    app_client: httpx.AsyncClient,
    collect_fakes: CollectFakes,
    snapshots: FakeSnapshotSource,
) -> None:
    source = await create_source(app_client)
    await create_points(
        app_client, source["id"], point_item("alpha"), point_item("zeta")
    )
    online(collect_fakes, source["id"])
    snapshots.readings.update(
        {
            f"{source['id']}:alpha": PointReading(1.0, 1, "good"),
            f"{source['id']}:zeta": PointReading(None, 1, "bad"),
        }
    )

    response = await app_client.get(
        POINTS,
        params={"source_id": source["id"], "status": "abnormal", "size": 1},
    )

    assert response.status_code == 200
    result = payload(response)
    assert (result["total"], [item["code"] for item in result["items"]]) == (
        1,
        ["zeta"],
    )


@pytest.mark.parametrize(
    ("status", "codes"),
    [
        ("all", ["alpha", "beta", "gamma", "zeta"]),
        ("abnormal", ["beta", "gamma", "zeta"]),
        ("waiting", ["zeta"]),
        ("stale", []),
        ("good", ["alpha"]),
    ],
)
async def test_status_filters_use_quality_and_snapshot_presence(
    app_client: httpx.AsyncClient,
    collect_fakes: CollectFakes,
    snapshots: FakeSnapshotSource,
    status: str,
    codes: list[str],
) -> None:
    source = await create_source(app_client)
    await create_points(
        app_client,
        source["id"],
        *(point_item(code) for code in ("alpha", "beta", "gamma", "zeta")),
    )
    online(collect_fakes, source["id"])
    snapshots.readings.update(
        {
            f"{source['id']}:alpha": PointReading(0, 1, "good"),
            f"{source['id']}:beta": PointReading(None, 1, "bad"),
            f"{source['id']}:gamma": PointReading(False, 1, "uncertain"),
        }
    )
    response = await app_client.get(
        POINTS, params={"source_id": source["id"], "status": status}
    )
    assert response.status_code == 200
    result = payload(response)
    assert (result["total"], [item["code"] for item in result["items"]]) == (
        len(codes),
        codes,
    )


@pytest.mark.parametrize("state", ["offline", "unknown", None])
async def test_a_source_that_is_not_online_cannot_have_good_points(
    app_client: httpx.AsyncClient,
    collect_fakes: CollectFakes,
    snapshots: FakeSnapshotSource,
    state: str | None,
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"])
    if state is not None:
        online(collect_fakes, source["id"])
        collect_fakes.history.rows[-1]["state"] = state
    snapshots.readings[f"{source['id']}:outlet_temp"] = PointReading(
        1.0, 1, "good"
    )
    for status, total in (("good", 0), ("stale", 1), ("abnormal", 1)):
        response = await app_client.get(
            POINTS, params={"source_id": source["id"], "status": status}
        )
        assert response.status_code == 200
        assert payload(response)["total"] == total


async def test_status_filters_combine_with_source_and_keyword(
    app_client: httpx.AsyncClient,
    collect_fakes: CollectFakes,
    snapshots: FakeSnapshotSource,
) -> None:
    first = await create_source(app_client)
    other = await create_source(app_client, code="other")
    for source in (first, other):
        await create_points(
            app_client,
            source["id"],
            point_item("alpha", name="正常温度"),
            point_item("beta", name="异常温度"),
            point_item("other", name="异常压力"),
        )
        online(collect_fakes, source["id"])
        snapshots.readings[f"{source['id']}:alpha"] = PointReading(
            1.0, 1, "good"
        )
    response = await app_client.get(
        POINTS,
        params={
            "source_id": first["id"],
            "q": "温度",
            "status": "abnormal",
        },
    )
    assert response.status_code == 200
    result = payload(response)
    assert (result["total"], [item["code"] for item in result["items"]]) == (
        1,
        ["beta"],
    )
    assert snapshots.asked == [(f"{first['id']}:alpha", f"{first['id']}:beta")]


async def test_status_filters_work_across_sources(
    app_client: httpx.AsyncClient,
    collect_fakes: CollectFakes,
    snapshots: FakeSnapshotSource,
) -> None:
    first = await create_source(app_client)
    second = await create_source(app_client, code="other")
    for source in (first, second):
        await create_points(app_client, source["id"])
        online(collect_fakes, source["id"])
    snapshots.readings[f"{first['id']}:outlet_temp"] = PointReading(
        1.0, 1, "good"
    )
    response = await app_client.get(POINTS, params={"status": "abnormal"})
    assert response.status_code == 200
    result = payload(response)
    assert result["total"] == 1
    assert [item["source_id"] for item in result["items"]] == [second["id"]]


async def test_filtered_pagination_crosses_snapshot_read_batches(
    app_client: httpx.AsyncClient,
    collect_fakes: CollectFakes,
    snapshots: FakeSnapshotSource,
) -> None:
    source = await create_source(app_client)
    for start in range(0, 503, 200):
        await create_points(
            app_client,
            source["id"],
            *(
                point_item(f"point{index:04d}")
                for index in range(start, min(start + 200, 503))
            ),
        )
    online(collect_fakes, source["id"])
    snapshots.readings.update(
        {
            f"{source['id']}:point{index:04d}": PointReading(1.0, 1, "good")
            for index in range(503)
            if index not in (499, 500, 502)
        }
    )
    response = await app_client.get(
        POINTS,
        params={
            "source_id": source["id"],
            "status": "abnormal",
            "page": 2,
            "size": 2,
        },
    )
    assert response.status_code == 200
    result = payload(response)
    assert (result["total"], [item["code"] for item in result["items"]]) == (
        3,
        ["point0502"],
    )
    assert sum(len(batch) for batch in snapshots.asked) == 503
    assert all(len(batch) <= 500 for batch in snapshots.asked)


async def test_unfiltered_lists_do_not_depend_on_snapshots(
    app_client: httpx.AsyncClient, snapshots: FakeSnapshotSource
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"])
    snapshots.failure = DependencyUnavailable("缓存暂时不可用")
    response = await app_client.get(
        POINTS, params={"source_id": source["id"], "status": "all"}
    )
    assert response.status_code == 200
    assert payload(response)["total"] == 1
    assert snapshots.asked == []


async def test_empty_configuration_matches_need_no_runtime_reads(
    app_client: httpx.AsyncClient,
    snapshots: FakeSnapshotSource,
    collect_fakes: CollectFakes,
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"])
    collect_fakes.history.queries.clear()
    response = await app_client.get(
        POINTS,
        params={"source_id": source["id"], "q": "不存在", "status": "abnormal"},
    )
    assert response.status_code == 200
    assert (payload(response)["total"], payload(response)["items"]) == (0, [])
    assert snapshots.asked == []
    assert collect_fakes.history.queries == []


async def test_an_out_of_range_filtered_page_preserves_the_matching_total(
    app_client: httpx.AsyncClient, snapshots: FakeSnapshotSource
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"])
    response = await app_client.get(
        POINTS,
        params={"source_id": source["id"], "status": "waiting", "page": 2},
    )
    assert response.status_code == 200
    assert (payload(response)["total"], payload(response)["items"]) == (1, [])
    assert len(snapshots.asked) == 1


async def test_snapshot_failure_does_not_look_like_no_abnormal_points(
    app_client: httpx.AsyncClient, snapshots: FakeSnapshotSource
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"])
    snapshots.failure = DependencyUnavailable("缓存暂时不可用")
    response = await app_client.get(
        POINTS, params={"source_id": source["id"], "status": "abnormal"}
    )
    assert response.status_code == 503
    assert payload(response) is None


async def test_invalid_status_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(POINTS, params={"status": "invalid"})
    assert response.status_code == 400


async def test_runtime_dependency_failure_is_reported_unavailable(
    app_client: httpx.AsyncClient,
    collect_fakes: CollectFakes,
    snapshots: FakeSnapshotSource,
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"])
    snapshots.readings[f"{source['id']}:outlet_temp"] = PointReading(
        1.0, 1, "good"
    )
    collect_fakes.history.failure = HistoryUnavailable("运行态暂时不可用")
    response = await app_client.get(
        POINTS, params={"source_id": source["id"], "status": "abnormal"}
    )
    assert response.status_code == 503
    assert response.json()["data"] is None


async def test_status_query_timeouts_are_reported_unavailable(
    app_client: httpx.AsyncClient, snapshots: FakeSnapshotSource
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"])
    snapshots.failure = TimeoutError("快照读取超时")
    response = await app_client.get(
        POINTS, params={"source_id": source["id"], "status": "abnormal"}
    )
    assert response.status_code == 503
    assert "超时" in response.json()["message"]


@dataclass
class OutsideTransactionSnapshots(FakeSnapshotSource):
    """断言快照 IO 发生在配置事务之外。"""

    session: AsyncSession | None = None

    async def read(self, node_keys: Sequence[str]) -> dict[str, PointReading]:
        assert self.session is not None
        assert not self.session.in_transaction()
        return await super().read(node_keys)


async def test_runtime_reads_release_the_configuration_transaction(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"])
    snapshots = OutsideTransactionSnapshots(session=db_session)
    context = PointQueryContext(
        snapshots=snapshots,
        states=SourceStateSource(history=FakeHistorySource()),
    )
    result = await list_points(
        db_session,
        context,
        filters=PointFilters(uuid.UUID(source["id"]), None, "abnormal"),
        page=PageParams(page=1, size=20),
    )
    assert result.total == 1
    assert len(snapshots.asked) == 1
