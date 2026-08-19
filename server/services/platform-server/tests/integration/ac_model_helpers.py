"""模型面集成用例的公共件：造房间、建模、把模型置成「训过」。

⚠ 不从 tests.conftest 导入类型：`tests` 这个包名在 workspace 里被每个服务
各占一份，跨服务解析到谁全看 sys.path 顺序。
"""

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
from platform_server.apps.hvac.rooms import (
    MetricBand,
    RoomUnit,
)
from platform_server.apps.hvac.startups import BATCH_STATUS_READY

PREFIX = "/api/v1/platform"
BASE = datetime(2026, 1, 5, tzinfo=UTC)
MISSING_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
TZ = "Asia/Shanghai"

# conftest 的 `sign` fixture 形状
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
    # ⚠ 数据源对象名必须是合法的裸标识符（`quote_identifier` 会拒带横杠的），
    # 而 serial 里有横杠——真去读一次外库的用例会在这里炸，而现象是 500
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
                source_object=f"v_{serial.replace('-', '_')}",
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


async def add_unit(
    session: AsyncSession, room_id: uuid.UUID, serial: str
) -> str:
    """训练之后再往房间里加一台机组（造「工件不认识它」的局面用）。

    Args: session, room_id, serial。
    """
    suffix = uuid.uuid4().hex[:6]
    named = f"{serial}-{suffix}"
    session.add(AcUnit(serial=named, name=named, room_id=room_id))
    await session.flush()
    return named


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
        serving_sets=[list(item) for item in model.serving_sets],
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
