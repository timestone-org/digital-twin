"""模型三张表的持久层用例，打真实 Postgres。

守的是：JSONB/数组/字节的往返、级联删除、分页游标，以及库里那几条 CHECK
的拒绝路径——绕开应用直接改库也不该能摆出一个说谎的状态。
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.hvac.crud import (
    ac_model_artifact_crud,
    ac_model_crud,
    ac_model_prediction_crud,
)
from platform_server.apps.hvac.model_statuses import (
    MODEL_STATUS_FAILED,
    MODEL_STATUS_READY,
)
from platform_server.apps.hvac.models import (
    AcModel,
    AcModelArtifact,
    AcModelPrediction,
    Room,
    Workshop,
)

pytestmark = pytest.mark.requires_postgres

BASE = datetime(2026, 3, 1, 0, 0, tzinfo=UTC)


async def make_room(session: AsyncSession, label: str) -> uuid.UUID:
    """建一个车间与一个房间，返回房间 id。

    Args: session, label。
    """
    workshop = Workshop(name=f"{label}车间{uuid.uuid4().hex[:8]}")
    session.add(workshop)
    await session.flush()
    room = Room(workshop_id=workshop.id, name=f"{label}房")
    session.add(room)
    await session.flush()
    return room.id


def make_model(room_id: uuid.UUID, *, name: str = "默认模型") -> AcModel:
    """造一个刚入队的模型。

    Args: room_id, name。
    """
    return AcModel(
        room_id=room_id,
        name=name,
        serving_sets=[["K11"], ["K11", "K12"]],
        half_life_days=180.0,
        created_by="tester",
    )


def make_prediction(
    model_id: uuid.UUID, *, minute: int, p50: float = 30.0
) -> AcModelPrediction:
    """造一条折外预测。

    Args: model_id, minute, p50。
    """
    return AcModelPrediction(
        model_id=model_id,
        started_at=BASE + timedelta(minutes=minute),
        running_set=["K11"],
        actual_minutes=25,
        p10=p50 - 10,
        p50=p50,
        p90=p50 + 10,
        fold=0,
    )


async def test_serving_sets_round_trip_as_nested_arrays(
    db_session: AsyncSession,
) -> None:
    """服务组合是组合的列表，JSONB 往返不走样。"""
    room_id = await make_room(db_session, "往返")
    model = make_model(room_id)
    db_session.add(model)
    await db_session.flush()
    found = await ac_model_crud.get(db_session, model.id)
    assert found is not None
    assert found.serving_sets == [["K11"], ["K11", "K12"]]
    assert found.status == "queued"


async def test_the_same_name_can_repeat_across_rooms_only(
    db_session: AsyncSession,
) -> None:
    """名字在房间内唯一，跨房间可以重复。"""
    first = await make_room(db_session, "甲")
    second = await make_room(db_session, "乙")
    db_session.add(make_model(first, name="同名"))
    db_session.add(make_model(second, name="同名"))
    await db_session.flush()
    db_session.add(make_model(first, name="同名"))
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_a_failed_model_must_carry_a_reason(
    db_session: AsyncSession,
) -> None:
    """⚠ 失败必须留人话原因：静默失败在库里就无法表示。"""
    room_id = await make_room(db_session, "失败")
    model = make_model(room_id)
    model.status = MODEL_STATUS_FAILED
    db_session.add(model)
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_ready_requires_training_output(
    db_session: AsyncSession,
) -> None:
    """⚠ ready 必然训练过：没有评估的 ready 是在对页面撒谎。"""
    room_id = await make_room(db_session, "就绪")
    model = make_model(room_id)
    model.status = MODEL_STATUS_READY
    db_session.add(model)
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_deleting_a_model_takes_artifact_and_predictions(
    db_session: AsyncSession,
) -> None:
    """级联删除：模型没了，工件与折外预测不留孤儿。"""
    room_id = await make_room(db_session, "级联")
    model = make_model(room_id)
    db_session.add(model)
    await db_session.flush()
    await ac_model_artifact_crud.put(
        db_session,
        AcModelArtifact(
            model_id=model.id,
            payload=b"artifact-bytes",
            digest="0" * 64,
            format_version=1,
            sklearn_version="1.9.0",
        ),
    )
    await ac_model_prediction_crud.replace_all(
        db_session,
        model_id=model.id,
        rows=[make_prediction(model.id, minute=0)],
    )
    await db_session.delete(model)
    await db_session.flush()
    assert await ac_model_artifact_crud.get(db_session, model.id) is None
    rows = await ac_model_prediction_crud.page(
        db_session, model_id=model.id, running_set=None, offset=0, limit=10
    )
    assert rows == []


async def test_replacing_predictions_is_wholesale(
    db_session: AsyncSession,
) -> None:
    """折外预测是派生数据：重训整体换掉，不残留上一次的行。"""
    room_id = await make_room(db_session, "重放")
    model = make_model(room_id)
    db_session.add(model)
    await db_session.flush()
    await ac_model_prediction_crud.replace_all(
        db_session,
        model_id=model.id,
        rows=[make_prediction(model.id, minute=minute) for minute in (0, 1)],
    )
    await ac_model_prediction_crud.replace_all(
        db_session,
        model_id=model.id,
        rows=[make_prediction(model.id, minute=2)],
    )
    rows = await ac_model_prediction_crud.page(
        db_session, model_id=model.id, running_set=None, offset=0, limit=10
    )
    assert [row.started_at for row in rows] == [BASE + timedelta(minutes=2)]


async def test_prediction_pages_follow_the_offset(
    db_session: AsyncSession,
) -> None:
    """按起始时刻倒序翻页，偏移接着上一页走，不重复不漏行；总数可知。"""
    room_id = await make_room(db_session, "翻页")
    model = make_model(room_id)
    db_session.add(model)
    await db_session.flush()
    await ac_model_prediction_crud.replace_all(
        db_session,
        model_id=model.id,
        rows=[make_prediction(model.id, minute=minute) for minute in range(5)],
    )
    first = await ac_model_prediction_crud.page(
        db_session, model_id=model.id, running_set=None, offset=0, limit=2
    )
    second = await ac_model_prediction_crud.page(
        db_session, model_id=model.id, running_set=None, offset=2, limit=2
    )
    minutes = [
        int((row.started_at - BASE).total_seconds() // 60)
        for row in [*first, *second]
    ]
    assert minutes == [4, 3, 2, 1]
    total = await ac_model_prediction_crud.count_matching(
        db_session, model_id=model.id, running_set=None
    )
    assert total == 5


async def test_crossed_quantiles_are_rejected_by_the_table(
    db_session: AsyncSession,
) -> None:
    """⚠ 分位交叉在库里也拒绝：坏一行就坏一页对比。"""
    room_id = await make_room(db_session, "交叉")
    model = make_model(room_id)
    db_session.add(model)
    await db_session.flush()
    bad = make_prediction(model.id, minute=0)
    bad.p10 = 50.0
    db_session.add(bad)
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_the_artifact_write_is_an_overwrite(
    db_session: AsyncSession,
) -> None:
    """工件覆盖式写入：一个模型永远只有最近一次成功训练的那份。"""
    room_id = await make_room(db_session, "工件")
    model = make_model(room_id)
    db_session.add(model)
    await db_session.flush()
    for digest in ("1" * 64, "2" * 64):
        await ac_model_artifact_crud.put(
            db_session,
            AcModelArtifact(
                model_id=model.id,
                payload=digest.encode(),
                digest=digest,
                format_version=1,
                sklearn_version="1.9.0",
            ),
        )
    found = await ac_model_artifact_crud.get(db_session, model.id)
    assert found is not None
    assert found.digest == "2" * 64
