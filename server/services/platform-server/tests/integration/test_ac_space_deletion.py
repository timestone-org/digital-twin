"""删空调与删房间撞上依赖行时的去向，打真实 Postgres。

⚠ 绑定、达标范围、模型与开机事件都用不带 ON DELETE 的外键挂在空调或房间上：
不先处理，删除会在提交时撞外键，调用方拿到的是 500 而不是能看懂的结果。
"""

import uuid
from datetime import UTC, datetime

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.hvac.models import AcUnit, Room, Workshop
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.services.ac_startup_service import (
    request_rebuild,
)

PREFIX = "/api/v1/platform"
ROOM_NOT_EMPTY = 41608
WINDOW = TimeWindow(
    start=datetime(2026, 1, 1, tzinfo=UTC), end=datetime(2026, 2, 1, tzinfo=UTC)
)


async def make_unit(client: httpx.AsyncClient, label: str) -> str:
    """建车间、房间与一台空调，返回空调 id。

    Args: client, label。
    """
    workshop = await client.post(
        f"{PREFIX}/workshops", json={"name": f"{label}车间"}
    )
    assert workshop.status_code == 201, workshop.text
    room = await client.post(
        f"{PREFIX}/rooms",
        json={"workshop_id": workshop.json()["data"]["id"], "name": "房"},
    )
    assert room.status_code == 201, room.text
    unit = await client.post(
        f"{PREFIX}/ac-units",
        json={
            "serial": f"AC-{label}",
            "name": f"{label}机",
            "room_id": room.json()["data"]["id"],
        },
    )
    assert unit.status_code == 201, unit.text
    return str(unit.json()["data"]["id"])


async def test_a_configured_unit_can_be_deleted(
    app_client: httpx.AsyncClient,
) -> None:
    """绑定与达标范围是空调自己的配置，跟着空调一起走。"""
    unit = await make_unit(app_client, "已配置")
    bound = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/data-bindings/raw_minute",
        json={"source_object": "KTStartData_K03"},
    )
    assert bound.status_code == 200, bound.text
    limited = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/metric-limits",
        json={
            "items": [
                {
                    "metric": "workshop_temp_avg",
                    "lower_limit": "20.00",
                    "upper_limit": "26.00",
                }
            ]
        },
    )
    assert limited.status_code == 200, limited.text
    removed = await app_client.delete(f"{PREFIX}/ac-units/{unit}")
    assert removed.status_code == 204, removed.text
    lookup = await app_client.get(f"{PREFIX}/ac-units/{unit}")
    assert lookup.status_code == 404


async def test_a_room_with_startup_history_is_rejected_with_409(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """房间有过抽取批次时拒删，而不是在提交时撞外键成 500。"""
    workshop = Workshop(name=f"有历史车间{uuid.uuid4().hex[:8]}")
    db_session.add(workshop)
    await db_session.flush()
    room = Room(workshop_id=workshop.id, name="有历史房")
    db_session.add(room)
    await db_session.flush()
    unit = AcUnit(room_id=room.id, serial="AC-HISTORY", name="历史机")
    db_session.add(unit)
    await db_session.flush()
    await request_rebuild(
        db_session, room_id=room.id, window=WINDOW, rules=ExtractionRules()
    )
    removed = await app_client.delete(f"{PREFIX}/ac-units/{unit.id}")
    assert removed.status_code == 204, removed.text
    blocked = await app_client.delete(f"{PREFIX}/rooms/{room.id}")
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["code"] == ROOM_NOT_EMPTY
