"""训练的执行面：取数、进程池拟合、落库。跑在 worker 角色里。

⚠ 拟合是 CPU 密集，必须经进程池——几秒的阻塞会卡住同一事件循环上的另一条
消费循环与心跳（docs/AC_MODEL_DESIGN.md §4）。本模块喂给进程池的与收回来
的都是纯数据。
"""

import asyncio
import uuid
from concurrent.futures import Executor
from dataclasses import asdict, dataclass
from functools import partial

from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from lib.logging import get_logger
from lib.utils.timeutils import utcnow
from platform_server.apps.hvac.crud import (
    ac_model_artifact_crud,
    ac_model_crud,
    ac_model_prediction_crud,
    ac_startup_batch_crud,
    ac_startup_episode_crud,
    ac_startup_exclusion_crud,
)
from platform_server.apps.hvac.model_statuses import (
    MODEL_STATUS_FAILED,
    MODEL_STATUS_READY,
    MODEL_STATUS_TRAINING,
)
from platform_server.apps.hvac.modeling.evaluation import (
    ModelMetrics,
    summarize,
)
from platform_server.apps.hvac.modeling.features import (
    FEATURE_VERSION,
    EpisodeSample,
    StartConditions,
)
from platform_server.apps.hvac.modeling.training import (
    InsufficientSamples,
    TrainedModel,
    train,
)
from platform_server.apps.hvac.models import (
    AcModel,
    AcModelArtifact,
    AcModelPrediction,
    AcStartupBatch,
    AcStartupEpisode,
)
from platform_server.apps.hvac.rooms import RoomUnit
from platform_server.apps.hvac.services.ac_startup_extract import (
    load_bound_units,
)
from platform_server.apps.hvac.startups import OUTCOME_USABLE

_logger = get_logger("platform.hvac.ac_model_trainer")


class TrainingRejected(Exception):
    """训练没法开始（缺数据）。异常信息就是给人看的原因。"""


# 训练一次的去向，消费者据此记不同的日志 event
TRAIN_RUN_TRAINED = "trained"
TRAIN_RUN_FAILED = "failed"
TRAIN_RUN_ORPHANED = "orphaned"


@dataclass(frozen=True)
class TrainRun:
    """一次训练消息的处理结果。"""

    outcome: str
    reason: str | None = None


@dataclass(frozen=True)
class _Inputs:
    """训练要用的全部数据，一次读出。"""

    samples: list[EpisodeSample]
    units: list[RoomUnit]
    batch: AcStartupBatch


async def run_training(
    database: Database,
    *,
    executor: Executor,
    timezone: str,
    model_id: uuid.UUID,
) -> TrainRun:
    """跑一次训练：标记 → 取数 → 进程池拟合 → 落库。

    幂等：重复消息按行里的当前配置再训一次，结果覆盖写，收敛到同一状态。
    ⚠ 标记 `training` 是单独一个事务：训练要跑几十秒，页面在这期间必须能
    看到「训练中」，而不是一个纹丝不动的 queued。
    Args: database, executor, timezone, model_id。
    """
    async with database.session() as session:
        model = await ac_model_crud.lock(session, model_id)
        if model is None:
            return TrainRun(TRAIN_RUN_ORPHANED, reason="模型已被删除")
        model.status = MODEL_STATUS_TRAINING
        half_life_days = model.half_life_days
        serving_sets = [list(item) for item in model.serving_sets]
        room_id = model.room_id
    try:
        async with database.session() as session:
            inputs = await _load_inputs(session, room_id)
        trained = await _fit(
            executor,
            inputs,
            timezone=timezone,
            half_life_days=half_life_days,
            serving_sets=serving_sets,
        )
    except (InsufficientSamples, TrainingRejected) as error:
        return await _mark_failed(database, model_id, reason=str(error))
    _log_curation(model_id, room_id, trained)
    async with database.session() as session:
        return await _persist(session, model_id, inputs, trained)


def _log_curation(
    model_id: uuid.UUID, room_id: uuid.UUID, trained: TrainedModel
) -> None:
    """甄别数出对不上的标签就报出来。

    ⚠ 这是批次过期目前唯一的迹象：达标范围与数据源绑定都不进批次指纹，改了
    它们页面不会提醒重抽，可事件的标签当场就作废了。放宽范围造出前一个数、
    收窄造出后一个，任一个不为零都该先去重算批次再训。
    Args: model_id, room_id, trained。
    """
    if not trained.contradictory_count and not trained.unexplained_zero_count:
        return
    _logger.warning(
        "ac_model_stale_labels_detected",
        "开机事件的标签与当前达标范围对不上",
        model_id=str(model_id),
        room_id=str(room_id),
        dropped_count=trained.contradictory_count,
        unexplained_zero_count=trained.unexplained_zero_count,
        trained_count=trained.sample_count,
    )


async def _load_inputs(session: AsyncSession, room_id: uuid.UUID) -> _Inputs:
    """读出当前批次的可用事件（剔除人工排除）与房间机组。

    Args: session, room_id。
    """
    batch = await ac_startup_batch_crud.find_current(session, room_id)
    if batch is None:
        raise TrainingRejected("这个房间还没有抽取出来的当前批次，先去重算")
    bound = await load_bound_units(session, room_id)
    if not bound:
        raise TrainingRejected("这个房间没有一台空调绑定了数据源")
    units = sorted((item.unit for item in bound), key=lambda unit: unit.serial)
    excluded = await ac_startup_exclusion_crud.map_by_room(session, room_id)
    episodes = await ac_startup_episode_crud.list_by_batch(session, batch.id)
    samples = [
        _to_sample(row)
        for row in episodes
        if row.outcome == OUTCOME_USABLE and row.started_at not in excluded
    ]
    return _Inputs(samples=samples, units=units, batch=batch)


def _to_sample(row: AcStartupEpisode) -> EpisodeSample:
    """事件行 → 训练样本。

    Args: row。
    """
    # usable 的事件由表上的 CHECK 保证有时长；这里的 0 只为类型收敛
    duration = row.duration_minutes if row.duration_minutes is not None else 0
    return EpisodeSample(
        conditions=StartConditions(
            started_at=row.started_at,
            running_set=tuple(row.running_set),
            idle_minutes=row.idle_minutes,
            readings=row.readings,
        ),
        duration_minutes=duration,
    )


async def _fit(
    executor: Executor,
    inputs: _Inputs,
    *,
    timezone: str,
    half_life_days: float,
    serving_sets: list[list[str]],
) -> TrainedModel:
    """把拟合丢进进程池并等结果。

    Args: executor, inputs, timezone, half_life_days, serving_sets。
    """
    return await asyncio.get_running_loop().run_in_executor(
        executor,
        partial(
            train,
            inputs.samples,
            units=inputs.units,
            timezone=timezone,
            half_life_days=half_life_days,
            serving_sets=serving_sets,
        ),
    )


async def _persist(
    session: AsyncSession,
    model_id: uuid.UUID,
    inputs: _Inputs,
    trained: TrainedModel,
) -> TrainRun:
    """工件、折外预测、指标与出处在同一事务里落库。

    Args: session, model_id, inputs, trained。
    """
    model = await ac_model_crud.lock(session, model_id)
    if model is None:
        # 训练期间被删了：产物无处可放，丢弃即可（级联已把从表清干净）
        return TrainRun(TRAIN_RUN_ORPHANED, reason="模型在训练期间被删除")
    metrics = summarize(trained.oof, model.serving_sets)
    await ac_model_artifact_crud.put(
        session,
        AcModelArtifact(
            model_id=model.id,
            payload=trained.artifact.payload,
            digest=trained.artifact.digest,
            format_version=trained.artifact.format_version,
            sklearn_version=trained.artifact.sklearn_version,
        ),
    )
    await ac_model_prediction_crud.replace_all(
        session,
        model_id=model.id,
        rows=[
            AcModelPrediction(
                model_id=model.id,
                started_at=row.started_at,
                running_set=list(row.running_set),
                actual_minutes=row.actual_minutes,
                p10=row.p10,
                p50=row.p50,
                p90=row.p90,
                fold=row.fold,
            )
            for row in trained.oof
        ],
    )
    _snapshot(model, inputs, trained, metrics)
    return TrainRun(TRAIN_RUN_TRAINED)


def _snapshot(
    model: AcModel,
    inputs: _Inputs,
    trained: TrainedModel,
    metrics: ModelMetrics,
) -> None:
    """把训练出处与评估写到模型行上。

    Args: model, inputs, trained, metrics。
    """
    model.status = MODEL_STATUS_READY
    model.error = None
    model.trained_at = utcnow()
    model.feature_version = FEATURE_VERSION
    model.batch_fingerprint = inputs.batch.params_fingerprint
    model.batch_logic_version = inputs.batch.logic_version
    model.window_start = inputs.batch.window_start
    model.window_end = inputs.batch.window_end
    model.sample_count = trained.sample_count
    model.metrics = metrics_to_json(metrics)


def metrics_to_json(metrics: ModelMetrics) -> dict[str, object]:
    """评估 → JSONB 形状；PATCH 改服务组合后就地重汇总也走它。

    Args: metrics。
    """
    return {
        "overall": asdict(metrics.overall),
        "by_set": {
            key: asdict(block) if block is not None else None
            for key, block in metrics.by_set.items()
        },
    }


async def _mark_failed(
    database: Database, model_id: uuid.UUID, *, reason: str
) -> TrainRun:
    """标记失败并带上人话原因。

    ⚠ 只改状态与原因，不动工件/预测/评估：重训失败保留上一份能用的产物
    （docs/AC_MODEL_DESIGN.md §3.1）。
    Args: database, model_id, reason。
    """
    async with database.session() as session:
        model = await ac_model_crud.lock(session, model_id)
        if model is None:
            return TrainRun(TRAIN_RUN_ORPHANED, reason="模型已被删除")
        model.status = MODEL_STATUS_FAILED
        model.error = reason
    return TrainRun(TRAIN_RUN_FAILED, reason=reason)


async def mark_failed(
    database: Database, model_id: uuid.UUID, *, reason: str
) -> None:
    """给消费者的失败出口（超时或未知异常时调用）。

    Args: database, model_id, reason。
    """
    await _mark_failed(database, model_id, reason=reason)
