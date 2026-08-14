"""训练执行面的整链用例：真库取数 → 拟合 → 落库。

⚠ 这里用线程池顶替进程池：Executor 接口一致，进程池的隔离价值在生产，
用例要验的是取数与落库两头的正确性。拟合本体已在单测里验过。
"""

import uuid
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import cast

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from platform_server.apps.hvac.crud import (
    ac_model_artifact_crud,
    ac_model_crud,
    ac_model_prediction_crud,
)
from platform_server.apps.hvac.model_statuses import (
    MODEL_STATUS_FAILED,
    MODEL_STATUS_READY,
)
from platform_server.apps.hvac.modeling.artifact import load
from platform_server.apps.hvac.models import (
    AcDataBinding,
    AcMetricLimit,
    AcModel,
    AcStartupBatch,
    AcStartupEpisode,
    AcStartupExclusion,
    AcUnit,
    Room,
    Workshop,
)
from platform_server.apps.hvac.services.ac_model_trainer import (
    TRAIN_RUN_FAILED,
    TRAIN_RUN_ORPHANED,
    TRAIN_RUN_TRAINED,
    mark_failed,
    run_training,
)
from platform_server.apps.hvac.startups import (
    BATCH_STATUS_READY,
    OUTCOME_TIMEOUT,
    OUTCOME_USABLE,
)

pytestmark = pytest.mark.requires_postgres

BASE = datetime(2026, 1, 5, 0, 0, tzinfo=UTC)
TZ = "Asia/Shanghai"


class OneSessionDatabase:
    """把测试的回滚事务会话装成 `Database` 的形状。

    ⚠ 训练执行面会开好几个「事务」，这里全部落在同一个外层回滚事务里：
    提交由外层假装，隔离性不在本用例的守备范围。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        yield self._session
        await self._session.flush()


async def _seed_unit(
    session: AsyncSession, *, room_id: uuid.UUID, serial: str
) -> None:
    """一台绑定了数据源、配了温度达标范围的机组。

    Args: session, room_id, serial。
    """
    unit = AcUnit(serial=serial, name=serial, room_id=room_id)
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


@dataclass(frozen=True)
class SeededRoom:
    """种出来的房间：id、两台机组的 serial 与批次 id。"""

    room_id: uuid.UUID
    batch_id: uuid.UUID
    serials: tuple[str, str]


async def seed_room(session: AsyncSession, *, episodes: int) -> SeededRoom:
    """种一个两台空调的房间：绑定、达标范围、当前批次与可用事件。

    ⚠ serial 全场唯一，带随机后缀；事件的 running_set 与 readings 必须用
    同一个字符串，否则特征全成 NaN，用例就只在验「盲列中和」了。
    Args: session, episodes。
    """
    suffix = uuid.uuid4().hex[:6]
    serials = (f"K11-{suffix}", f"K12-{suffix}")
    workshop = Workshop(name=f"车间{suffix}")
    session.add(workshop)
    await session.flush()
    room = Room(workshop_id=workshop.id, name="训练房")
    session.add(room)
    await session.flush()
    for serial in serials:
        await _seed_unit(session, room_id=room.id, serial=serial)
    batch = AcStartupBatch(
        room_id=room.id,
        params_fingerprint="f" * 64,
        logic_version=2,
        window_start=BASE,
        window_end=BASE + timedelta(days=400),
        status=BATCH_STATUS_READY,
        is_current=True,
        shard_total=1,
        shard_done=1,
        episode_count=episodes,
    )
    session.add(batch)
    await session.flush()
    for index in range(episodes):
        over = 1.0 + (index % 6)
        session.add(
            AcStartupEpisode(
                batch_id=batch.id,
                room_id=room.id,
                started_at=BASE + timedelta(days=index, minutes=index),
                running_set=[serials[0]],
                complied_at=BASE
                + timedelta(days=index, minutes=index + int(8 * over)),
                duration_minutes=int(8 * over),
                outcome=OUTCOME_USABLE,
                readings={serials[0]: {"workshop_temp_avg": 26.0 + over}},
                idle_minutes=390,
            )
        )
    await session.flush()
    return SeededRoom(room_id=room.id, batch_id=batch.id, serials=serials)


def make_model(seeded: SeededRoom) -> AcModel:
    """一个待训的模型行，服务组合用种出来的真 serial。

    Args: seeded。
    """
    return AcModel(
        room_id=seeded.room_id,
        name="整链",
        serving_sets=[[seeded.serials[0]], list(seeded.serials)],
        half_life_days=180.0,
        created_by="tester",
    )


async def test_training_persists_everything_in_one_go(
    db_session: AsyncSession,
) -> None:
    """训完：状态 ready、评估落行、折外逐条落表、工件能过护栏加载。"""
    seeded = await seed_room(db_session, episodes=40)
    model = make_model(seeded)
    db_session.add(model)
    await db_session.flush()
    with ThreadPoolExecutor(max_workers=1) as executor:
        run = await run_training(
            cast(Database, OneSessionDatabase(db_session)),
            executor=executor,
            timezone=TZ,
            model_id=model.id,
        )
    assert run.outcome == TRAIN_RUN_TRAINED
    found = await ac_model_crud.get(db_session, model.id)
    assert found is not None
    assert found.status == MODEL_STATUS_READY
    assert found.sample_count == 40
    assert found.batch_fingerprint == "f" * 64
    assert found.metrics is not None
    assert found.metrics["overall"]["count"] == 40
    pair_key = "+".join(sorted(seeded.serials))
    assert found.metrics["by_set"][pair_key] is None
    solo = found.metrics["by_set"][seeded.serials[0]]
    assert solo is not None
    assert solo["count"] == 40
    # 事件时长都大于零，故整体块与热行块都算得出 R²
    assert isinstance(found.metrics["overall"]["r2"], float)
    assert isinstance(found.metrics["overall"]["hot"]["r2"], float)
    rows = await ac_model_prediction_crud.page(
        db_session, model_id=model.id, running_set=None, offset=0, limit=100
    )
    assert len(rows) == 40
    artifact = await ac_model_artifact_crud.get(db_session, model.id)
    assert artifact is not None
    bundle = load(
        artifact.payload,
        digest=artifact.digest,
        format_version=artifact.format_version,
        trained_sklearn_version=artifact.sklearn_version,
    )
    assert bundle.feature_names


async def test_manual_exclusions_are_left_out_of_training(
    db_session: AsyncSession,
) -> None:
    """人工排除的事件不进训练集，样本数如实少一条。"""
    seeded = await seed_room(db_session, episodes=40)
    db_session.add(
        AcStartupExclusion(
            room_id=seeded.room_id,
            started_at=BASE,
            reason="手工核对有误",
            excluded_by="tester",
        )
    )
    model = make_model(seeded)
    db_session.add(model)
    await db_session.flush()
    with ThreadPoolExecutor(max_workers=1) as executor:
        run = await run_training(
            cast(Database, OneSessionDatabase(db_session)),
            executor=executor,
            timezone=TZ,
            model_id=model.id,
        )
    assert run.outcome == TRAIN_RUN_TRAINED
    found = await ac_model_crud.get(db_session, model.id)
    assert found is not None
    assert found.sample_count == 39


async def test_unusable_episodes_never_reach_the_training_set(
    db_session: AsyncSession,
) -> None:
    """非 usable 的事件（如超时）不进训练集。"""
    seeded = await seed_room(db_session, episodes=30)
    db_session.add(
        AcStartupEpisode(
            batch_id=seeded.batch_id,
            room_id=seeded.room_id,
            started_at=BASE + timedelta(days=300),
            running_set=[seeded.serials[0]],
            complied_at=None,
            duration_minutes=None,
            outcome=OUTCOME_TIMEOUT,
            readings={seeded.serials[0]: {"workshop_temp_avg": 30.0}},
            idle_minutes=100,
        )
    )
    model = make_model(seeded)
    db_session.add(model)
    await db_session.flush()
    with ThreadPoolExecutor(max_workers=1) as executor:
        run = await run_training(
            cast(Database, OneSessionDatabase(db_session)),
            executor=executor,
            timezone=TZ,
            model_id=model.id,
        )
    assert run.outcome == TRAIN_RUN_TRAINED
    found = await ac_model_crud.get(db_session, model.id)
    assert found is not None
    assert found.sample_count == 30


async def test_too_few_samples_fail_with_a_human_reason(
    db_session: AsyncSession,
) -> None:
    """样本不够：失败落行、原因是人话、评估与工件保持原样（没有）。"""
    seeded = await seed_room(db_session, episodes=5)
    model = make_model(seeded)
    db_session.add(model)
    await db_session.flush()
    with ThreadPoolExecutor(max_workers=1) as executor:
        run = await run_training(
            cast(Database, OneSessionDatabase(db_session)),
            executor=executor,
            timezone=TZ,
            model_id=model.id,
        )
    assert run.outcome == TRAIN_RUN_FAILED
    found = await ac_model_crud.get(db_session, model.id)
    assert found is not None
    assert found.status == MODEL_STATUS_FAILED
    assert found.error is not None
    assert "30" in found.error
    assert await ac_model_artifact_crud.get(db_session, model.id) is None


async def test_a_room_without_a_current_batch_refuses_to_train(
    db_session: AsyncSession,
) -> None:
    """没有当前批次：失败并把「先去重算」说出来。"""
    workshop = Workshop(name=f"车间{uuid.uuid4().hex[:8]}")
    db_session.add(workshop)
    await db_session.flush()
    room = Room(workshop_id=workshop.id, name="空房")
    db_session.add(room)
    await db_session.flush()
    model = AcModel(
        room_id=room.id,
        name="整链",
        serving_sets=[["K11"]],
        half_life_days=180.0,
        created_by="tester",
    )
    db_session.add(model)
    await db_session.flush()
    with ThreadPoolExecutor(max_workers=1) as executor:
        run = await run_training(
            cast(Database, OneSessionDatabase(db_session)),
            executor=executor,
            timezone=TZ,
            model_id=model.id,
        )
    assert run.outcome == TRAIN_RUN_FAILED
    found = await ac_model_crud.get(db_session, model.id)
    assert found is not None
    assert found.error is not None
    assert "重算" in found.error


async def test_training_a_deleted_model_is_orphaned(
    db_session: AsyncSession,
) -> None:
    """模型已删：孤儿路径，不炸不重放。"""
    with ThreadPoolExecutor(max_workers=1) as executor:
        run = await run_training(
            cast(Database, OneSessionDatabase(db_session)),
            executor=executor,
            timezone=TZ,
            model_id=uuid.uuid4(),
        )
    assert run.outcome == TRAIN_RUN_ORPHANED


async def test_a_room_with_no_bound_units_refuses_to_train(
    db_session: AsyncSession,
) -> None:
    """机组都没绑数据源：失败并把原因说成人话。"""
    seeded = await seed_room(db_session, episodes=0)
    await db_session.execute(
        delete(AcDataBinding).where(
            AcDataBinding.ac_unit_id.in_(
                select(AcUnit.id).where(AcUnit.room_id == seeded.room_id)
            )
        )
    )
    model = make_model(seeded)
    db_session.add(model)
    await db_session.flush()
    with ThreadPoolExecutor(max_workers=1) as executor:
        run = await run_training(
            cast(Database, OneSessionDatabase(db_session)),
            executor=executor,
            timezone=TZ,
            model_id=model.id,
        )
    assert run.outcome == TRAIN_RUN_FAILED
    found = await ac_model_crud.get(db_session, model.id)
    assert found is not None
    assert found.error is not None
    assert "数据源" in found.error


async def test_marking_a_deleted_model_failed_is_a_noop(
    db_session: AsyncSession,
) -> None:
    """消费者的失败出口对已删模型不炸：无处可落就算了。"""
    ghost = uuid.uuid4()
    await mark_failed(
        cast(Database, OneSessionDatabase(db_session)),
        ghost,
        reason="超时",
    )
    assert await ac_model_crud.get(db_session, ghost) is None
