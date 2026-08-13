"""模型面的读侧：对外模型的组装与折外预测的游标翻页。"""

import uuid
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import Page, PageParams
from platform_server.apps.hvac.crud import ac_model_prediction_crud
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
    ErrorStatsOut,
    MetricsBlockOut,
    ModelMetricsOut,
    ModelPredictionOut,
)
from platform_server.apps.hvac.schemas.common import RoomRef, WorkshopRef
from platform_server.apps.hvac.services import ac_model_service


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
    params: PageParams,
) -> Page[ModelPredictionOut]:
    """折外逐条的页码翻页，最新的在前，可按组合过滤。

    页码而不是游标：折外预测是训练时整体替换的有界快照，不是追加型
    时序流——总数可知且不会翻着翻着多出新行，页码直选对用户更顺手。
    Args: session, model_id, running_set, params。
    """
    serials = list(running_set) if running_set else None
    rows = await ac_model_prediction_crud.page(
        session,
        model_id=model_id,
        running_set=serials,
        offset=params.offset,
        limit=params.size,
    )
    total = await ac_model_prediction_crud.count_matching(
        session, model_id=model_id, running_set=serials
    )
    return Page[ModelPredictionOut](
        items=[_to_prediction(row) for row in rows],
        page=params.page,
        size=params.size,
        total=total,
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

    ⚠ 热行/判零字段是后加的，老评估 JSON 里没有——缺就给 None，不算坏形状；
    重训后自然补齐。
    Args: raw。
    """
    if not isinstance(raw, dict):
        return None
    values = cast(dict[str, object], raw)
    try:
        base = _stats_of(values)
        zero_count = values.get("zero_count")
        return MetricsBlockOut(
            count=base.count,
            mae=base.mae,
            medae=base.medae,
            rmse=base.rmse,
            coverage=base.coverage,
            mean_width=base.mean_width,
            reliability=base.reliability,
            hot=_hot_out(values.get("hot")),
            zero_count=(
                int(zero_count) if isinstance(zero_count, int) else None
            ),
            zero_hit_rate=_rate_of(values.get("zero_hit_rate")),
            hot_hit_rate=_rate_of(values.get("hot_hit_rate")),
        )
    except (KeyError, TypeError, ValueError):
        return None


def _hot_out(raw: object) -> ErrorStatsOut | None:
    """热行统计的 JSON → 对外模型；没有热行或老 JSON 都是 None。

    Args: raw。
    """
    if not isinstance(raw, dict):
        return None
    try:
        return _stats_of(cast(dict[str, object], raw))
    except (KeyError, TypeError, ValueError):
        return None


def _stats_of(values: dict[str, object]) -> ErrorStatsOut:
    """误差统计六元组的 JSON → 对外模型，可靠性按区间宽度现算。

    Args: values。
    """
    mean_width = float(cast(float, values["mean_width"]))
    return ErrorStatsOut(
        count=int(cast(int, values["count"])),
        mae=float(cast(float, values["mae"])),
        medae=float(cast(float, values["medae"])),
        rmse=float(cast(float, values["rmse"])),
        coverage=float(cast(float, values["coverage"])),
        mean_width=mean_width,
        reliability=reliability(mean_width),
    )


def _rate_of(raw: object) -> float | None:
    """0~1 的占比字段；缺失或非数按 None。

    Args: raw。
    """
    if isinstance(raw, (int, float)):
        return float(raw)
    return None
