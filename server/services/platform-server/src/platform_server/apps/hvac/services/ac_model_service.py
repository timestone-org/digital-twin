"""模型面的写侧应用服务：建、改、删与重训入队。

推理侧（试算/推荐）在 `ac_model_predictor`，读侧组装在 `ac_model_query`。
⚠ 建模与重训只入队不训练（API 角色永不跑重任务）；入队沿用
`request_rebuild` 的先例：**自己提交，之后才投消息**。
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from lib.logging import get_logger
from lib.stream import StreamGroup, StreamLike
from platform_server.apps.hvac.crud import (
    ac_model_crud,
    ac_model_prediction_crud,
    ac_startup_batch_crud,
)
from platform_server.apps.hvac.errors import (
    ModelBatchMissing,
    ModelConfigInvalid,
    ModelNameTaken,
    ModelNotFound,
    ModelTrainingInProgress,
    RoomNotFound,
)
from platform_server.apps.hvac.model_statuses import (
    MODEL_STATUS_FAILED,
    MODEL_STATUS_QUEUED,
    MODEL_STATUS_TRAINING,
)
from platform_server.apps.hvac.modeling.evaluation import (
    OofPrediction,
    set_key,
    summarize,
)
from platform_server.apps.hvac.models import (
    AcModel,
    AcStartupBatch,
    AcUnit,
    Room,
    Workshop,
)
from platform_server.apps.hvac.schemas import (
    AcModelCreateIn,
    AcModelPatchIn,
)
from platform_server.apps.hvac.services import ac_model_queue
from platform_server.apps.hvac.services.ac_model_queue import TrainMessage
from platform_server.apps.hvac.services.ac_model_trainer import (
    metrics_to_json,
)

_logger = get_logger("platform.hvac.ac_model_service")


async def list_with_refs(
    session: AsyncSession, *, room_id: uuid.UUID | None
) -> list[tuple[AcModel, Room, Workshop]]:
    """全部模型连同房间与车间（可按房间过滤），新建的在前。

    Args: session, room_id。
    """
    statement = (
        select(AcModel, Room, Workshop)
        .join(Room, AcModel.room_id == Room.id)
        .join(Workshop, Room.workshop_id == Workshop.id)
        .order_by(AcModel.created_at.desc(), AcModel.id.desc())
    )
    if room_id is not None:
        statement = statement.where(AcModel.room_id == room_id)
    rows = await session.execute(statement)
    return [(model, room, workshop) for model, room, workshop in rows.all()]


async def get_with_refs(
    session: AsyncSession, model_id: uuid.UUID
) -> tuple[AcModel, Room, Workshop]:
    """按 id 取一个模型连同房间与车间，没有就 404。

    Args: session, model_id。
    """
    rows = await session.execute(
        select(AcModel, Room, Workshop)
        .join(Room, AcModel.room_id == Room.id)
        .join(Workshop, Room.workshop_id == Workshop.id)
        .where(AcModel.id == model_id)
    )
    found = rows.first()
    if found is None:
        raise ModelNotFound("模型不存在")
    return (found[0], found[1], found[2])


async def get_model(session: AsyncSession, model_id: uuid.UUID) -> AcModel:
    """按 id 取一个模型，没有就 404。

    Args: session, model_id。
    """
    model = await ac_model_crud.get(session, model_id)
    if model is None:
        raise ModelNotFound("模型不存在")
    return model


async def create_model(
    session: AsyncSession, payload: AcModelCreateIn, *, created_by: str
) -> tuple[AcModel, TrainMessage]:
    """建模并入队第一次训练。**本函数自己提交**。

    Args: session, payload, created_by。
    """
    room = await session.get(Room, payload.room_id)
    if room is None:
        raise RoomNotFound("房间不存在")
    if (
        await ac_startup_batch_crud.find_current(session, payload.room_id)
        is None
    ):
        raise ModelBatchMissing(
            "这个房间还没有抽取出来的开机事件，先在开机事件页重算一次"
        )
    serials = await _room_serials(session, payload.room_id)
    serving_sets = _normalized_sets(payload.serving_sets, serials)
    if await ac_model_crud.get_by_name(
        session, room_id=payload.room_id, name=payload.name
    ):
        raise ModelNameTaken("这个房间里已经有同名模型")
    model = AcModel(
        room_id=payload.room_id,
        name=payload.name,
        description=payload.description,
        serving_sets=serving_sets,
        half_life_days=payload.half_life_days,
        status=MODEL_STATUS_QUEUED,
        created_by=created_by,
    )
    session.add(model)
    await session.flush()
    # ⚠ 就地提交（同 request_rebuild 的教训）：投递跑在响应发出的那一刻，
    # 而那早于 yield 依赖的提交——不提交，消费者会看见「模型不存在」
    await session.commit()
    _logger.info(
        "ac_model_created",
        "模型已建并入队训练",
        model_id=str(model.id),
        room_id=str(payload.room_id),
    )
    return model, ac_model_queue.new_message(model.id)


async def patch_model(
    session: AsyncSession, model_id: uuid.UUID, payload: AcModelPatchIn
) -> AcModel:
    """改名、改描述或改服务组合；改组合就地重汇总评估，不重训。

    Args: session, model_id, payload。
    """
    model = await ac_model_crud.lock(session, model_id)
    if model is None:
        raise ModelNotFound("模型不存在")
    if payload.name is not None and payload.name != model.name:
        if await ac_model_crud.get_by_name(
            session, room_id=model.room_id, name=payload.name
        ):
            raise ModelNameTaken("这个房间里已经有同名模型")
        model.name = payload.name
    if payload.description is not None:
        model.description = payload.description
    if payload.serving_sets is not None:
        serials = await _room_serials(session, model.room_id)
        model.serving_sets = _normalized_sets(payload.serving_sets, serials)
        await _resummarize(session, model)
    await session.flush()
    return model


async def _resummarize(session: AsyncSession, model: AcModel) -> None:
    """按存好的折外预测给新的服务组合重算分组评估。

    Args: session, model。
    """
    if model.metrics is None:
        return
    rows = await ac_model_prediction_crud.page(
        session,
        model_id=model.id,
        running_set=None,
        offset=0,
        limit=1_000_000,
    )
    oof = [
        OofPrediction(
            started_at=row.started_at,
            running_set=tuple(row.running_set),
            actual_minutes=row.actual_minutes,
            p10=row.p10,
            p50=row.p50,
            p90=row.p90,
            fold=row.fold,
        )
        for row in rows
    ]
    if not oof:
        return
    model.metrics = metrics_to_json(summarize(oof, model.serving_sets))


async def request_retrain(
    session: AsyncSession, model_id: uuid.UUID
) -> tuple[AcModel, TrainMessage]:
    """重训入队。**本函数自己提交**（同 create_model）。

    Args: session, model_id。
    """
    model = await ac_model_crud.lock(session, model_id)
    if model is None:
        raise ModelNotFound("模型不存在")
    if model.status in (MODEL_STATUS_QUEUED, MODEL_STATUS_TRAINING):
        raise ModelTrainingInProgress(
            "这个模型已经排队或正在训练，重复触发只会白算一遍"
        )
    model.status = MODEL_STATUS_QUEUED
    await session.flush()
    await session.commit()
    _logger.info(
        "ac_model_retrain_requested",
        "重训已入队",
        model_id=str(model_id),
    )
    return model, ac_model_queue.new_message(model_id)


async def delete_model(session: AsyncSession, model_id: uuid.UUID) -> None:
    """删除模型（工件与折外预测级联跟走）。DELETE 必须幂等。

    Args: session, model_id。
    """
    model = await ac_model_crud.get(session, model_id)
    if model is None:
        return
    await session.delete(model)
    await session.flush()


async def dispatch_training(
    stream: StreamLike,
    database: Database,
    *,
    target: StreamGroup,
    message: TrainMessage,
) -> None:
    """把训练任务投进队列。**必须在事务提交之后跑**。

    ⚠ 投递失败就把模型判失败：否则它会永远停在 queued，页面看起来在排队，
    其实没有任何一条消息在路上。
    Args: stream, database, target, message。
    """
    try:
        await ac_model_queue.publish_training(
            stream, target=target, message=message
        )
    # 队列不可达时不重试：这条链路上没有任何一层在重试，失败要看得见
    except Exception as error:
        _logger.error(
            "ac_model_dispatch_failed",
            "训练任务未能入队，模型判失败",
            model_id=str(message.model_id),
            error=error,
        )
        await _open_and_fail(database, message.model_id)


async def _open_and_fail(database: Database, model_id: uuid.UUID) -> None:
    """自开一个会话把模型判失败（投递失败时没有请求会话可用）。

    Args: database, model_id。
    """
    try:
        async with database.session() as session:
            model = await ac_model_crud.lock(session, model_id)
            if model is not None:
                model.status = MODEL_STATUS_FAILED
                model.error = "训练任务未能入队，请重试"
    except Exception as error:  # pragma: no cover - 队列与库同时不可用
        _logger.error(
            "ac_model_dispatch_failure_unrecorded",
            "投递失败未能落库",
            model_id=str(model_id),
            error=error,
        )


def batch_stale_map(
    models: Sequence[AcModel], current_by_room: dict[uuid.UUID, str]
) -> dict[uuid.UUID, bool]:
    """每个模型的「数据已更新」位：训练时的批次指纹 ≠ 房间当前批次指纹。

    没训过或房间没有当前批次都算不过期——没有可比对象时不该闪提示。
    Args: models, current_by_room。
    """
    found: dict[uuid.UUID, bool] = {}
    for model in models:
        current = current_by_room.get(model.room_id)
        found[model.id] = (
            model.batch_fingerprint is not None
            and current is not None
            and model.batch_fingerprint != current
        )
    return found


async def current_fingerprints(
    session: AsyncSession, room_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """一批房间的当前批次指纹，逐房间回查就是 N+1。

    Args: session, room_ids。
    """
    if not room_ids:
        return {}
    rows = await session.execute(
        select(AcStartupBatch.room_id, AcStartupBatch.params_fingerprint).where(
            AcStartupBatch.room_id.in_(set(room_ids)),
            AcStartupBatch.is_current.is_(True),
        )
    )
    return dict(rows.tuples().all())


async def _room_serials(
    session: AsyncSession, room_id: uuid.UUID
) -> frozenset[str]:
    """房间里全部机组的 serial。

    Args: session, room_id。
    """
    rows = await session.execute(
        select(AcUnit.serial).where(AcUnit.room_id == room_id)
    )
    return frozenset(rows.scalars().all())


def _normalized_sets(
    asked: Sequence[Sequence[str]], serials: frozenset[str]
) -> list[list[str]]:
    """校验并规整服务组合：非空、去重、serial 升序、必须是房间机组的子集。

    Args: asked, serials。
    """
    found: list[list[str]] = []
    seen: set[str] = set()
    for raw in asked:
        cleaned = sorted(set(raw))
        if not cleaned:
            raise ModelConfigInvalid("服务组合不能为空")
        unknown = [item for item in cleaned if item not in serials]
        if unknown:
            raise ModelConfigInvalid(
                f"组合里有不属于这个房间的机组：{'、'.join(unknown)}"
            )
        key = set_key(cleaned)
        if key in seen:
            raise ModelConfigInvalid(f"服务组合重复：{key}")
        seen.add(key)
        found.append(cleaned)
    return found
