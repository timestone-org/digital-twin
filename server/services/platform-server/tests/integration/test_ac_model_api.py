"""模型面八个端点的读写口径，打真实 Postgres。

⚠ 建模与重训只入队，请求路径里一次拟合都不许发生；试算是纯计算，
对服务组合之外的组合不拒绝但要标外推。
"""

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.model_statuses import (
    MODEL_STATUS_READY,
)
from platform_server.apps.hvac.modeling.features import (
    EpisodeSample,
    StartConditions,
)
from platform_server.apps.hvac.modeling.training import train
from platform_server.apps.hvac.models import (
    AcDataBinding,
    AcMetricLimit,
    AcModel,
    AcModelArtifact,
    AcModelPrediction,
    AcStartupBatch,
    AcUnit,
    Room,
    Workshop,
)
from platform_server.apps.hvac.services.ac_startup_frames import (
    MetricBand,
    RoomUnit,
)
from platform_server.apps.hvac.startups import BATCH_STATUS_READY

pytestmark = pytest.mark.requires_postgres

PREFIX = "/api/v1/platform"
BASE = datetime(2026, 1, 5, tzinfo=UTC)
MISSING_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
TZ = "Asia/Shanghai"

# conftest 的 `sign` fixture 形状。⚠ 不从 tests.conftest 导入：`tests` 这个包名
# 在 workspace 里被每个服务各占一份，跨服务解析到谁全看 sys.path 顺序。
SignHeaders = Callable[..., dict[str, str]]


class Seeded:
    """一个可建模的房间：两台绑了数据源的机组 + 当前批次。"""

    def __init__(self, room_id: uuid.UUID, serials: tuple[str, str]) -> None:
        self.room_id = room_id
        self.serials = serials


async def seed_room(session: AsyncSession) -> Seeded:
    """种房间、机组、绑定与当前批次。

    Args: session。
    """
    suffix = uuid.uuid4().hex[:6]
    serials = (f"K11-{suffix}", f"K12-{suffix}")
    workshop = Workshop(name=f"车间{suffix}")
    session.add(workshop)
    await session.flush()
    room = Room(workshop_id=workshop.id, name="建模房")
    session.add(room)
    await session.flush()
    for serial in serials:
        unit = AcUnit(serial=serial, name=serial, room_id=room.id)
        session.add(unit)
        await session.flush()
        session.add(
            AcDataBinding(
                ac_unit_id=unit.id,
                dataset="raw_minute",
                source_object=f"v_{serial}",
            )
        )
        session.add(
            AcMetricLimit(
                ac_unit_id=unit.id,
                metric="workshop_temp_avg",
                lower_limit=Decimal(18),
                upper_limit=Decimal(26),
            )
        )
    session.add(
        AcStartupBatch(
            room_id=room.id,
            params_fingerprint="f" * 64,
            logic_version=2,
            window_start=BASE,
            window_end=BASE + timedelta(days=200),
            status=BATCH_STATUS_READY,
            is_current=True,
            shard_total=1,
            shard_done=1,
        )
    )
    await session.flush()
    return Seeded(room.id, serials)


def create_body(seeded: Seeded, **over: Any) -> dict[str, Any]:
    """一份合法的建模入参。

    Args: seeded, over。
    """
    body: dict[str, Any] = {
        "room_id": str(seeded.room_id),
        "name": "早班模型",
        "serving_sets": [[seeded.serials[0]], list(seeded.serials)],
    }
    body.update(over)
    return body


async def create_model(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    seeded: Seeded,
    **over: Any,
) -> dict[str, Any]:
    """走接口建一个模型并返回 data。

    Args: client, headers, seeded, over。
    """
    response = await client.post(
        f"{PREFIX}/ac-models", json=create_body(seeded, **over), headers=headers
    )
    assert response.status_code == 202, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


async def test_create_queues_training_and_normalizes_sets(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """建模 202：状态 queued，组合去重升序，带房间与车间引用。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(
        app_client,
        manager,
        seeded,
        serving_sets=[[seeded.serials[1], seeded.serials[0]]],
    )
    assert data["status"] == "queued"
    assert data["serving_sets"] == [sorted(seeded.serials)]
    assert data["room"]["name"] == "建模房"
    assert data["metrics"] is None
    assert data["is_batch_stale"] is False


async def test_create_rejects_a_foreign_serial(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """组合越出房间机组：422 且说出是哪台。"""
    seeded = await seed_room(db_session)
    response = await app_client.post(
        f"{PREFIX}/ac-models",
        json=create_body(seeded, serving_sets=[["K99"]]),
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == 422
    assert response.json()["code"] == 41620
    assert "K99" in response.json()["message"]


async def test_create_requires_a_current_batch(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """没抽取过的房间不能建模：409 提示先去重算。"""
    workshop = Workshop(name=f"车间{uuid.uuid4().hex[:8]}")
    db_session.add(workshop)
    await db_session.flush()
    room = Room(workshop_id=workshop.id, name="没数据房")
    db_session.add(room)
    await db_session.flush()
    response = await app_client.post(
        f"{PREFIX}/ac-models",
        json={
            "room_id": str(room.id),
            "name": "空转",
            "serving_sets": [["K11"]],
        },
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == 409
    assert response.json()["code"] == 41621


async def test_create_rejects_a_duplicate_name_in_the_room(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """同房间同名：409。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    await create_model(app_client, manager, seeded)
    response = await app_client.post(
        f"{PREFIX}/ac-models", json=create_body(seeded), headers=manager
    )
    assert response.status_code == 409
    assert response.json()["code"] == 41619


async def test_the_list_filters_by_room(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """列表可按房间过滤；查看权限就够。"""
    manager = sign([AC_MANAGE])
    first = await seed_room(db_session)
    second = await seed_room(db_session)
    await create_model(app_client, manager, first)
    await create_model(app_client, manager, second, name="另一个")
    listing = await app_client.get(
        f"{PREFIX}/ac-models",
        params={"room_id": str(first.room_id)},
        headers=sign([AC_VIEW]),
    )
    assert listing.status_code == 200
    items = listing.json()["data"]
    assert [item["name"] for item in items] == ["早班模型"]


async def test_patching_serving_sets_resummarizes_in_place(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """改服务组合就地重汇总：分组指标跟着变，不触发重训。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    model_id = uuid.UUID(data["id"])
    solo = [seeded.serials[0]]
    await _mark_trained(db_session, model_id, running_set=solo)
    response = await app_client.patch(
        f"{PREFIX}/ac-models/{model_id}",
        json={"serving_sets": [solo, list(seeded.serials)]},
        headers=manager,
    )
    assert response.status_code == 200
    metrics = response.json()["data"]["metrics"]
    assert metrics is not None
    assert metrics["by_set"][seeded.serials[0]]["count"] == 2
    assert metrics["by_set"]["+".join(sorted(seeded.serials))] is None
    assert response.json()["data"]["status"] == MODEL_STATUS_READY


async def test_retrain_conflicts_while_queued(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """queued/training 期间重训是 409：重复触发只会白算一遍。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    response = await app_client.post(
        f"{PREFIX}/ac-models/{data['id']}:retrain", headers=manager
    )
    assert response.status_code == 409
    assert response.json()["code"] == 41623


async def test_retrain_requeues_a_trained_model(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """训过的模型可以重训：202 且回到 queued。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    model_id = uuid.UUID(data["id"])
    await _mark_trained(db_session, model_id, running_set=[seeded.serials[0]])
    response = await app_client.post(
        f"{PREFIX}/ac-models/{model_id}:retrain", headers=manager
    )
    assert response.status_code == 202
    assert response.json()["data"]["status"] == "queued"


async def test_delete_is_idempotent(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """删两次都是 204。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    first = await app_client.delete(
        f"{PREFIX}/ac-models/{data['id']}", headers=manager
    )
    second = await app_client.delete(
        f"{PREFIX}/ac-models/{data['id']}", headers=manager
    )
    assert first.status_code == 204
    assert second.status_code == 204


async def test_prediction_pages_walk_by_cursor(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """逐条对比按游标翻页，不重复不漏行；坏游标 422。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    model_id = uuid.UUID(data["id"])
    await _mark_trained(
        db_session,
        model_id,
        running_set=[seeded.serials[0]],
        prediction_count=5,
    )
    viewer = sign([AC_VIEW])
    url = f"{PREFIX}/ac-models/{model_id}/predictions"
    first = await app_client.get(url, params={"limit": 2}, headers=viewer)
    assert first.status_code == 200
    page = first.json()["data"]
    assert len(page["items"]) == 2
    assert page["has_more"] is True
    second = await app_client.get(
        url, params={"limit": 2, "after": page["next"]}, headers=viewer
    )
    stamps = [
        item["started_at"]
        for item in page["items"] + second.json()["data"]["items"]
    ]
    assert stamps == sorted(stamps, reverse=True)
    assert len(set(stamps)) == 4
    broken = await app_client.get(
        url, params={"after": "垃圾游标"}, headers=viewer
    )
    assert broken.status_code == 422
    assert broken.json()["code"] == 41615


async def test_a_missing_model_is_404_everywhere(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    """详情、逐条与试算对不存在的模型一律 404。"""
    viewer = sign([AC_VIEW])
    for url in (
        f"{PREFIX}/ac-models/{MISSING_ID}",
        f"{PREFIX}/ac-models/{MISSING_ID}/predictions",
    ):
        response = await app_client.get(url, headers=viewer)
        assert response.status_code == 404
        assert response.json()["code"] == 41618


async def _mark_trained(
    session: AsyncSession,
    model_id: uuid.UUID,
    *,
    running_set: list[str],
    prediction_count: int = 2,
) -> None:
    """把一个模型置成「训过」：真训一个小工件 + 折外行 + 评估落库。

    Args: session, model_id, running_set, prediction_count。
    """
    model = await session.get(AcModel, model_id)
    assert model is not None
    trained = train(
        [_sample(index, running_set) for index in range(30)],
        units=await _trained_units(session, model),
        timezone=TZ,
        half_life_days=180.0,
    )
    session.add(
        AcModelArtifact(
            model_id=model_id,
            payload=trained.artifact.payload,
            digest=trained.artifact.digest,
            format_version=trained.artifact.format_version,
            sklearn_version=trained.artifact.sklearn_version,
        )
    )
    _seed_outcome(model, running_set, prediction_count)
    for row in _seed_predictions(model_id, running_set, prediction_count):
        session.add(row)
    await session.flush()


async def _trained_units(
    session: AsyncSession, model: AcModel
) -> list[RoomUnit]:
    """训练用的机组清单 = 房间全部机组（与生产取数一致）。

    Args: session, model。
    """
    rows = await session.execute(
        select(AcUnit.serial).where(AcUnit.room_id == model.room_id)
    )
    band = MetricBand(lower=Decimal(18), upper=Decimal(26))
    return [
        RoomUnit(serial=serial, bands={"workshop_temp_avg": band})
        for serial in sorted(rows.scalars().all())
    ]


def _seed_outcome(
    model: AcModel, running_set: list[str], prediction_count: int
) -> None:
    """把训练产出的状态与评估写到模型行上。

    Args: model, running_set, prediction_count。
    """
    del running_set
    model.status = MODEL_STATUS_READY
    model.trained_at = BASE
    model.feature_version = 1
    model.sample_count = 30
    model.metrics = {
        "overall": {
            "count": prediction_count,
            "mae": 2.0,
            "medae": 2.0,
            "rmse": 2.5,
            "coverage": 1.0,
            "mean_width": 15.0,
        },
        "by_set": {},
    }


def _seed_predictions(
    model_id: uuid.UUID, running_set: list[str], count: int
) -> list[AcModelPrediction]:
    """几条折外预测行。

    Args: model_id, running_set, count。
    """
    return [
        AcModelPrediction(
            model_id=model_id,
            started_at=BASE + timedelta(hours=index),
            running_set=sorted(running_set),
            actual_minutes=20 + index,
            p10=15.0,
            p50=22.0,
            p90=30.0,
            fold=0,
        )
        for index in range(count)
    ]


def _sample(index: int, running_set: list[str]) -> EpisodeSample:
    """一条合成训练样本。

    Args: index, running_set。
    """
    over = 1.0 + (index % 5)
    return EpisodeSample(
        conditions=StartConditions(
            started_at=BASE + timedelta(days=index),
            running_set=tuple(sorted(running_set)),
            idle_minutes=300,
            readings={running_set[0]: {"workshop_temp_avg": 26.0 + over}},
        ),
        duration_minutes=int(8 * over),
    )


async def test_predictions_filter_by_running_set(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """逐条对比按组合过滤：别的组合的行不出现。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    model_id = uuid.UUID(data["id"])
    await _mark_trained(db_session, model_id, running_set=[seeded.serials[0]])
    hit = await app_client.get(
        f"{PREFIX}/ac-models/{model_id}/predictions",
        params={"running_set": seeded.serials[0]},
        headers=sign([AC_VIEW]),
    )
    assert len(hit.json()["data"]["items"]) == 2
    miss = await app_client.get(
        f"{PREFIX}/ac-models/{model_id}/predictions",
        params={"running_set": ",".join(seeded.serials)},
        headers=sign([AC_VIEW]),
    )
    assert miss.json()["data"]["items"] == []
