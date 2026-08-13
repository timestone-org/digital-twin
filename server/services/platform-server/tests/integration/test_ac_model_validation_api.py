"""建模与改配置的校验拒绝路径，打真实 Postgres。

⚠ 每条拒绝都要给人话：空组合、重复组合、越界机组、撞名、404，
错在哪一档就报哪一档，造房间的公共件复用模型面用例那份。
"""

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.test_ac_model_api import (
    MISSING_ID,
    PREFIX,
    SignHeaders,
    create_body,
    create_model,
    seed_room,
)
from platform_server.apps.hvac.catalog import AC_MANAGE

pytestmark = pytest.mark.requires_postgres


async def test_create_rejects_empty_and_duplicate_sets(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """空组合与重复组合都 422，各自说清是哪种。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    empty = await app_client.post(
        f"{PREFIX}/ac-models",
        json=create_body(seeded, serving_sets=[[]]),
        headers=manager,
    )
    assert empty.status_code == 422
    assert "不能为空" in empty.json()["message"]
    doubled = await app_client.post(
        f"{PREFIX}/ac-models",
        json=create_body(
            seeded,
            serving_sets=[
                [seeded.serials[0]],
                [seeded.serials[0], seeded.serials[0]],
            ],
        ),
        headers=manager,
    )
    assert doubled.status_code == 422
    assert "重复" in doubled.json()["message"]


async def test_create_in_a_missing_room_is_404(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.post(
        f"{PREFIX}/ac-models",
        json={
            "room_id": MISSING_ID,
            "name": "无家可归",
            "serving_sets": [["K11"]],
        },
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == 404
    assert response.json()["code"] == 41602


async def test_patch_validates_like_create(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """改名撞同名 409；改描述不动其它字段；对不存在的模型 404。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    first = await create_model(app_client, manager, seeded)
    await create_model(app_client, manager, seeded, name="第二个")
    clash = await app_client.patch(
        f"{PREFIX}/ac-models/{first['id']}",
        json={"name": "第二个"},
        headers=manager,
    )
    assert clash.status_code == 409
    described = await app_client.patch(
        f"{PREFIX}/ac-models/{first['id']}",
        json={"description": "夜班用"},
        headers=manager,
    )
    assert described.json()["data"]["description"] == "夜班用"
    assert described.json()["data"]["name"] == "早班模型"
    missing = await app_client.patch(
        f"{PREFIX}/ac-models/{MISSING_ID}",
        json={"description": "x"},
        headers=manager,
    )
    assert missing.status_code == 404
    retrain_missing = await app_client.post(
        f"{PREFIX}/ac-models/{MISSING_ID}:retrain", headers=manager
    )
    assert retrain_missing.status_code == 404
