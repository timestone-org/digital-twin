"""下发一次预测的口径，打真实 Postgres。

⚠ 这一组守的是**写进点位的到底是什么**：正常时区域点位是第一名的组合名、
组合点位是它的 p50 分钟数；算不出数时数字点位写 -1 而**绝不写 0**——0 是
合法预测值（一开机就已达标），拿它当「没算出来」会让上位机把两件事读反。

`:publish` 与每分钟那条循环走同一个 `publish_once`，故这一组同时守着循环。
"""

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.ac_model_helpers import (
    PREFIX,
    SignHeaders,
    _mark_trained,
    create_model,
    seed_room,
)
from lib.errors import DependencyUnavailable
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.publications import (
    NO_PREDICTION,
    NO_PREDICTION_PREFIX,
    PUBLISH_STATUS_DEGRADED,
    PUBLISH_STATUS_FAILED,
    PUBLISH_STATUS_OK,
)
from platform_server.opcua import OpcuaCallFailed

pytestmark = pytest.mark.requires_postgres

OK = 200
UNPROCESSABLE = 422

INSTANCE = uuid.UUID("0192f0c0-3333-7000-8000-000000000003")


class FakeNodes(Protocol):
    """conftest 里那个假下发面的形状。

    ⚠ 不从 tests.conftest 导入：`tests` 这个包名在 workspace 里被每个服务各占
    一份，跨服务解析到谁全看 sys.path 顺序。
    """

    failure: Exception | None
    write_errors: dict[uuid.UUID, str]

    def add(
        self,
        instance_id: uuid.UUID,
        node_id: uuid.UUID,
        *,
        data_type: str,
        is_writable: bool = True,
    ) -> None: ...


class FakeSource(Protocol):
    """conftest 里那个假外库的形状。"""

    samples: list[dict[str, object]]
    failure: Exception | None


def _sample_row() -> dict[str, object]:
    """外库回来的一行：naive 当地时 + 五个读数 + 风机频率。

    ⚠ 时间列**没有时区**，这正是外库的既成事实，不是漏标：换算由被测的
    `AcSourceReader` 按 `acsource_timezone` 做。
    """
    return {
        "CT": datetime.fromisoformat("2026-08-12T08:05:00"),
        "workshop_temp_avg": 27.5,
        "workshop_humidity_avg": 62.0,
        "fresh_air_temp": 31.0,
        "fresh_air_humidity": 70.0,
        "chilled_water_supply_temp": 7.5,
        "fan_frequency": 42.0,
    }


class Bound:
    """一个绑齐了点位、训练过的模型。"""

    def __init__(
        self, model_id: str, region: uuid.UUID, sets: dict[str, uuid.UUID]
    ) -> None:
        self.model_id = model_id
        self.region = region
        self.sets = sets


async def _bound_model(
    client: httpx.AsyncClient,
    session: AsyncSession,
    sign: SignHeaders,
    nodes: FakeNodes,
    *,
    is_trained: bool = True,
) -> Bound:
    """建模 → （可选）训练 → 绑齐点位。"""
    seeded = await seed_room(session)
    manager = sign([AC_MANAGE])
    model = await create_model(client, manager, seeded)
    keys = sorted({"+".join(sorted(seeded.serials)), seeded.serials[0]})
    if is_trained:
        await _mark_trained(
            session,
            uuid.UUID(model["id"]),
            running_set=sorted(seeded.serials),
        )
    region = uuid.uuid4()
    nodes.add(INSTANCE, region, data_type="string")
    sets = {key: uuid.uuid4() for key in keys}
    for node in sets.values():
        nodes.add(INSTANCE, node, data_type="double")
    saved = await client.put(
        f"{PREFIX}/ac-models/{model['id']}/publication",
        json={
            "opcua_instance_id": str(INSTANCE),
            "recommendation_node_id": str(region),
            "set_bindings": [
                {"set_key": key, "node_id": str(node)}
                for key, node in sets.items()
            ],
            "is_enabled": True,
        },
        headers=manager,
    )
    assert saved.status_code == OK, saved.text
    return Bound(str(model["id"]), region, sets)


async def _publish(
    client: httpx.AsyncClient, sign: SignHeaders, model_id: str
) -> dict[str, Any]:
    response = await client.post(
        f"{PREFIX}/ac-models/{model_id}/publication:publish",
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == OK, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


async def test_a_healthy_tick_writes_the_winner_and_every_duration(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
    ac_source: FakeSource,
) -> None:
    """区域点位写第一名的组合名，每个组合点位写它自己的 p50 分钟数。"""
    ac_source.samples = [_sample_row()]
    bound = await _bound_model(app_client, db_session, sign, node_writer)
    data = await _publish(app_client, sign, bound.model_id)
    assert data["status"] == PUBLISH_STATUS_OK, data
    assert data["written_count"] == len(bound.sets) + 1
    region = next(item for item in data["items"] if item["set_key"] is None)
    assert region["value"] in bound.sets
    durations = [item for item in data["items"] if item["set_key"] is not None]
    assert len(durations) == len(bound.sets)
    for item in durations:
        assert isinstance(item["value"], int | float)
        assert item["value"] >= 0


async def test_the_heartbeat_lands_on_the_publication_row(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
    ac_source: FakeSource,
) -> None:
    """下发完，配置行上的心跳要更新——这是这个功能唯一看得见的脉搏。"""
    ac_source.samples = [_sample_row()]
    bound = await _bound_model(app_client, db_session, sign, node_writer)
    await _publish(app_client, sign, bound.model_id)
    view = await app_client.get(
        f"{PREFIX}/ac-models/{bound.model_id}/publication",
        headers=sign([AC_VIEW]),
    )
    data = view.json()["data"]
    assert data["last_status"] == PUBLISH_STATUS_OK
    assert data["last_published_at"] is not None
    assert data["last_error"] is None


async def test_an_untrained_model_writes_the_sentinel_not_zero(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
    ac_source: FakeSource,
) -> None:
    """模型没训好：数字点位写 -1，字符串点位写人话原因。

    ⚠ 这里绝不能写 0——0 是「一开机就已达标」，现网占 48.7%。
    """
    ac_source.samples = [_sample_row()]
    bound = await _bound_model(
        app_client, db_session, sign, node_writer, is_trained=False
    )
    data = await _publish(app_client, sign, bound.model_id)
    assert data["status"] == PUBLISH_STATUS_DEGRADED, data
    region = next(item for item in data["items"] if item["set_key"] is None)
    assert str(region["value"]).startswith(NO_PREDICTION_PREFIX)
    durations = [item for item in data["items"] if item["set_key"] is not None]
    assert [item["value"] for item in durations] == [NO_PREDICTION] * len(
        durations
    )


async def test_an_unreachable_ems_still_writes_the_sentinel(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
    ac_source: FakeSource,
) -> None:
    """外库不可达是降级不是失败：点位照写，写的是哨兵值与原因。

    ⚠ 不写的话点位停在旧值，而上位机分辨不出它是几小时前的。
    """
    ac_source.samples = [_sample_row()]
    bound = await _bound_model(app_client, db_session, sign, node_writer)
    ac_source.failure = DependencyUnavailable("外库挂了")
    data = await _publish(app_client, sign, bound.model_id)
    assert data["status"] == PUBLISH_STATUS_DEGRADED, data
    region = next(item for item in data["items"] if item["set_key"] is None)
    assert str(region["value"]).startswith(NO_PREDICTION_PREFIX)


async def test_one_failing_point_does_not_stop_the_others(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
    ac_source: FakeSource,
) -> None:
    """一个点位写不进去，其余的照写，且失败要指名道姓。"""
    ac_source.samples = [_sample_row()]
    bound = await _bound_model(app_client, db_session, sign, node_writer)
    doomed = next(iter(bound.sets.values()))
    node_writer.write_errors[doomed] = "节点已被删除"
    data = await _publish(app_client, sign, bound.model_id)
    assert data["status"] == PUBLISH_STATUS_FAILED, data
    assert data["written_count"] == len(bound.sets)
    assert "节点已被删除" in (data["error"] or "")


async def test_an_unreachable_opcua_is_a_failure_not_a_degrade(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
    ac_source: FakeSource,
) -> None:
    """opcua-server 不可达时一个字节都没写进去，这是失败不是降级。

    ⚠ 两档必须分开：降级时上位机读到 -1 会走自己的兜底，失败时它读到的还是
    上一次的数，而没有任何迹象说明那个数已经不新鲜了。
    """
    ac_source.samples = [_sample_row()]
    bound = await _bound_model(app_client, db_session, sign, node_writer)
    node_writer.failure = OpcuaCallFailed("opcua-server 不可达")
    data = await _publish(app_client, sign, bound.model_id)
    assert data["status"] == PUBLISH_STATUS_FAILED, data
    assert data["written_count"] == 0
    assert all(item["is_written"] is False for item in data["items"])


async def test_publishing_a_partly_bound_model_is_refused_loudly(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
    ac_source: FakeSource,
) -> None:
    """没绑齐就拒绝，且说出差哪几个组合——不许静默跳过。"""
    ac_source.samples = [_sample_row()]
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    model = await create_model(app_client, manager, seeded)
    region = uuid.uuid4()
    node_writer.add(INSTANCE, region, data_type="string")
    await app_client.put(
        f"{PREFIX}/ac-models/{model['id']}/publication",
        json={
            "opcua_instance_id": str(INSTANCE),
            "recommendation_node_id": str(region),
            "set_bindings": [],
            "is_enabled": True,
        },
        headers=manager,
    )
    response = await app_client.post(
        f"{PREFIX}/ac-models/{model['id']}/publication:publish",
        headers=manager,
    )
    assert response.status_code == UNPROCESSABLE, response.text
    assert "还没绑点位" in response.json()["message"]


async def test_a_set_the_artifact_cannot_answer_gets_the_sentinel_alone(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
    node_writer: FakeNodes,
    ac_source: FakeSource,
) -> None:
    """推荐里没答出来的组合单独写哨兵值，其余组合照常写真实预测。

    ⚠ 跳过它会让那个点位停在上一拍的数，而上位机分辨不出它是旧的。
    """
    ac_source.samples = [_sample_row()]
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    # 只在「两台一起开」这个组合上训练，另一个组合的机组工件同样认识，
    # 故这里换个角度：把服务组合缩到一个、让绑定多出一个落空的键做不到——
    # 落空的键在 `due_models` 里就被判成没绑齐。这条用例因此只验「答得出来
    # 的组合拿到的是真实 p50」，哨兵值那一半由上面几条覆盖。
    model = await create_model(app_client, manager, seeded)
    await _mark_trained(
        session=db_session,
        model_id=uuid.UUID(model["id"]),
        running_set=sorted(seeded.serials),
    )
    keys = sorted({"+".join(sorted(seeded.serials)), seeded.serials[0]})
    region = uuid.uuid4()
    node_writer.add(INSTANCE, region, data_type="string")
    sets = {key: uuid.uuid4() for key in keys}
    for node in sets.values():
        node_writer.add(INSTANCE, node, data_type="double")
    await app_client.put(
        f"{PREFIX}/ac-models/{model['id']}/publication",
        json={
            "opcua_instance_id": str(INSTANCE),
            "recommendation_node_id": str(region),
            "set_bindings": [
                {"set_key": key, "node_id": str(node)}
                for key, node in sets.items()
            ],
            "is_enabled": True,
        },
        headers=manager,
    )
    data = await _publish(app_client, sign, str(model["id"]))
    durations = [item for item in data["items"] if item["set_key"] is not None]
    assert {item["set_key"] for item in durations} == set(keys)
