"""模型面的推理侧：试算与开机策略推荐。纯计算，不训练也不碰外库。

写侧（建/改/删/入队）在 `ac_model_service`，读侧组装在 `ac_model_query`。
"""

import uuid
from dataclasses import dataclass, replace
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from lib.utils.timeutils import utcnow
from platform_server.apps.hvac.crud import ac_model_artifact_crud
from platform_server.apps.hvac.errors import (
    ModelArtifactUnusable,
    ModelConfigInvalid,
    ModelNotReady,
)
from platform_server.apps.hvac.modeling.artifact import (
    ArtifactRejected,
    ModelBundle,
    load,
    predict_mixture,
)
from platform_server.apps.hvac.modeling.evaluation import set_key
from platform_server.apps.hvac.modeling.features import (
    StartConditions,
    build_row,
)
from platform_server.apps.hvac.models import AcModel
from platform_server.apps.hvac.schemas import PredictIn, RecommendIn
from platform_server.apps.hvac.services import ac_model_service


@dataclass(frozen=True)
class PredictResult:
    """一次试算的结果。"""

    p10: float
    p50: float
    p90: float
    instant_probability: float
    is_in_serving_sets: bool
    # 答话的是这个组合的专属子模型，还是房间共用模型在兜底
    is_dedicated: bool
    trained_at: datetime


@dataclass(frozen=True)
class RecommendEntry:
    """推荐结果里一个组合的成绩。"""

    running_set: tuple[str, ...]
    set_key: str
    instant_probability: float
    p10: float
    p50: float
    p90: float
    is_dedicated: bool
    is_recommended: bool


@dataclass(frozen=True)
class RecommendResult:
    """全部服务组合按「更快达标」排好序的推荐。"""

    entries: list[RecommendEntry]
    trained_at: datetime


async def predict(
    session: AsyncSession, model_id: uuid.UUID, payload: PredictIn
) -> PredictResult:
    """试算：读工件、算特征、出三分位。

    Args: session, model_id, payload。
    """
    model, bundle = await _load_bundle(session, model_id)
    running = sorted(set(payload.running_set))
    unknown = [item for item in running if item not in bundle.serials]
    if unknown:
        raise ModelConfigInvalid(
            f"组合里有模型不认识的机组：{'、'.join(unknown)}"
        )
    found = _score_set(bundle, running, payload=payload)
    if model.trained_at is None:  # pragma: no cover - _load_bundle 已挡
        raise ModelNotReady("模型还没有一次成功的训练，先训练再试算")
    return PredictResult(
        p10=found.p10,
        p50=found.p50,
        p90=found.p90,
        instant_probability=found.instant_probability,
        is_in_serving_sets=set_key(running)
        in {set_key(serving) for serving in model.serving_sets},
        is_dedicated=found.is_dedicated,
        trained_at=model.trained_at,
    )


async def recommend(
    session: AsyncSession, model_id: uuid.UUID, payload: RecommendIn
) -> RecommendResult:
    """同一个起始条件下让全部服务组合同台比，排好序、第一名带推荐标。

    排序口径（AC_MODEL_DESIGN §5.4）：p50 快者优先，再比 p90，
    最后少开机组优先——同样快就选省电的。
    Args: session, model_id, payload。
    """
    model, bundle = await _load_bundle(session, model_id)
    scored = [
        _score_set(bundle, sorted(set(serving)), payload=payload)
        for serving in model.serving_sets
        if all(item in bundle.serials for item in serving)
    ]
    if not scored:
        raise ModelConfigInvalid(
            "服务组合里的机组都不在训练时的机组清单里，先重训再推荐"
        )
    scored.sort(
        key=lambda entry: (
            entry.p50,
            entry.p90,
            len(entry.running_set),
            entry.set_key,
        )
    )
    if model.trained_at is None:  # pragma: no cover - _load_bundle 已挡
        raise ModelNotReady("模型还没有一次成功的训练，先训练再推荐")
    return RecommendResult(
        entries=[
            replace(entry, is_recommended=(at == 0))
            for at, entry in enumerate(scored)
        ],
        trained_at=model.trained_at,
    )


async def _load_bundle(
    session: AsyncSession, model_id: uuid.UUID
) -> tuple[AcModel, ModelBundle]:
    """取模型与过完护栏的工件；没训过或工件不可用都在这里拒绝。

    Args: session, model_id。
    """
    model = await ac_model_service.get_model(session, model_id)
    stored = await ac_model_artifact_crud.get(session, model_id)
    if stored is None or model.trained_at is None:
        raise ModelNotReady("模型还没有一次成功的训练，先训练再试算")
    try:
        bundle = load(
            stored.payload,
            digest=stored.digest,
            format_version=stored.format_version,
            trained_sklearn_version=stored.sklearn_version,
        )
    except ArtifactRejected as error:
        raise ModelArtifactUnusable(str(error)) from error
    return model, bundle


def _score_set(
    bundle: ModelBundle,
    running: list[str],
    *,
    payload: PredictIn | RecommendIn,
) -> RecommendEntry:
    """一个组合在给定起始条件下的成绩（推荐标位由调用方定）。

    ⚠ 按工件自己的机组清单拼行，不按房间当前清单：房间变动不改老工件的列。
    Args: bundle, running（已排序去重）, payload。
    """
    row = build_row(
        _conditions_of(payload, running),
        units=bundle.units,
        timezone=bundle.timezone,
    )
    pair, is_dedicated = bundle.pair_for(set_key(running))
    found = predict_mixture(pair, row)
    return RecommendEntry(
        running_set=tuple(running),
        set_key=set_key(running),
        instant_probability=found.instant_probability,
        p10=found.p10,
        p50=found.p50,
        p90=found.p90,
        is_dedicated=is_dedicated,
        is_recommended=False,
    )


def _conditions_of(
    payload: PredictIn | RecommendIn, running: list[str]
) -> StartConditions:
    """试算/推荐入参 → 起始条件。

    Args: payload, running（已排序去重）。
    """
    return StartConditions(
        started_at=payload.at or utcnow(),
        running_set=tuple(running),
        idle_minutes=payload.idle_minutes,
        readings={
            serial: reading.model_dump(exclude_none=True)
            for serial, reading in payload.readings.items()
        },
    )
