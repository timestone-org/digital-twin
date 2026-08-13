"""模型面的读侧：对外模型的组装与折外预测的游标翻页。"""

import uuid
from datetime import datetime
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from lib.utils.timeutils import format_rfc3339
from lib.web import (
    CursorPage,
    CursorParams,
    decode_cursor,
    encode_cursor,
)
from platform_server.apps.hvac.crud import ac_model_prediction_crud
from platform_server.apps.hvac.errors import CursorInvalid
from platform_server.apps.hvac.modeling.features import FEATURE_VERSION
from platform_server.apps.hvac.modeling.gating import reliability
from platform_server.apps.hvac.models import (
    AcModel,
    AcModelPrediction,
    Room,
    Workshop,
)
from platform_server.apps.hvac.schemas import (
    AcModelOut,
    MetricsBlockOut,
    ModelMetricsOut,
    ModelPredictionOut,
)
from platform_server.apps.hvac.schemas.common import RoomRef, WorkshopRef
from platform_server.apps.hvac.services import ac_model_service

# 游标里装的字段名
_CURSOR_TIME_FIELD = "before"


def to_model_out(
    model: AcModel,
    room: Room,
    workshop: Workshop,
    *,
    is_batch_stale: bool,
) -> AcModelOut:
    """模型行 → 对外模型。

    Args: model, room, workshop, is_batch_stale。
    """
    return AcModelOut(
        id=model.id,
        name=model.name,
        description=model.description,
        room=RoomRef(id=room.id, name=room.name),
        workshop=WorkshopRef(id=workshop.id, name=workshop.name),
        serving_sets=[list(item) for item in model.serving_sets],
        half_life_days=model.half_life_days,
        status=model.status,
        error=model.error,
        feature_version=model.feature_version,
        trained_at=model.trained_at,
        sample_count=model.sample_count,
        window_start=model.window_start,
        window_end=model.window_end,
        metrics=_metrics_out(model.metrics),
        is_batch_stale=is_batch_stale,
        is_feature_stale=(
            model.feature_version is not None
            and model.feature_version != FEATURE_VERSION
        ),
        created_by=model.created_by,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


async def stale_flags(
    session: AsyncSession, models: list[AcModel]
) -> dict[uuid.UUID, bool]:
    """一批模型的「数据已更新」位。

    Args: session, models。
    """
    fingerprints = await ac_model_service.current_fingerprints(
        session, [model.room_id for model in models]
    )
    return ac_model_service.batch_stale_map(models, fingerprints)


async def prediction_page(
    session: AsyncSession,
    *,
    model_id: uuid.UUID,
    running_set: tuple[str, ...] | None,
    cursor: CursorParams,
) -> CursorPage[ModelPredictionOut]:
    """折外逐条的游标翻页，最新的在前。

    Args: session, model_id, running_set, cursor。
    """
    rows = await ac_model_prediction_crud.page(
        session,
        model_id=model_id,
        running_set=list(running_set) if running_set else None,
        before=_anchor_of(cursor.after),
        limit=cursor.limit + 1,
    )
    has_more = len(rows) > cursor.limit
    visible = rows[: cursor.limit]
    next_cursor = (
        encode_cursor(
            {_CURSOR_TIME_FIELD: format_rfc3339(visible[-1].started_at)}
        )
        if has_more and visible
        else None
    )
    return CursorPage[ModelPredictionOut](
        items=[_to_prediction(row) for row in visible],
        next=next_cursor,
        has_more=has_more,
    )


def _to_prediction(row: AcModelPrediction) -> ModelPredictionOut:
    """折外预测行 → 对外模型。

    Args: row。
    """
    return ModelPredictionOut(
        started_at=row.started_at,
        running_set=list(row.running_set),
        actual_minutes=row.actual_minutes,
        p10=row.p10,
        p50=row.p50,
        p90=row.p90,
        fold=row.fold,
    )


def _anchor_of(after: str | None) -> datetime | None:
    """游标解回锚点时刻；首页没有锚点。

    ⚠ 游标是客户端可以随手改的入参，解析失败要 422 不是 500。
    Args: after。
    """
    if after is None:
        return None
    try:
        payload = decode_cursor(after)
        moment = payload[_CURSOR_TIME_FIELD]
        return datetime.fromisoformat(moment)
    except Exception as error:
        raise CursorInvalid("游标不可解析，请从上一页响应里原样带回") from error


def _metrics_out(stored: dict[str, object] | None) -> ModelMetricsOut | None:
    """存库的评估 JSON → 对外模型，可靠性分档在读侧现算。

    Args: stored。
    """
    if stored is None:
        return None
    overall = _block_out(stored.get("overall"))
    if overall is None:
        return None
    by_set_raw = stored.get("by_set")
    by_set: dict[str, MetricsBlockOut | None] = {}
    if isinstance(by_set_raw, dict):
        for key, value in cast(dict[str, object], by_set_raw).items():
            by_set[key] = _block_out(value)
    return ModelMetricsOut(overall=overall, by_set=by_set)


def _block_out(raw: object) -> MetricsBlockOut | None:
    """一个指标块的 JSON → 对外模型；形状不对按没有处理。

    Args: raw。
    """
    if not isinstance(raw, dict):
        return None
    values = cast(dict[str, float], raw)
    try:
        mean_width = float(values["mean_width"])
        return MetricsBlockOut(
            count=int(values["count"]),
            mae=float(values["mae"]),
            medae=float(values["medae"]),
            rmse=float(values["rmse"]),
            coverage=float(values["coverage"]),
            mean_width=mean_width,
            reliability=reliability(mean_width),
        )
    except (KeyError, TypeError, ValueError):
        return None
