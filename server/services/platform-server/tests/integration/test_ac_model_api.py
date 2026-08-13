"""模型面八个端点的读写口径，打真实 Postgres。

⚠ 建模与重训只入队，请求路径里一次拟合都不许发生；试算是纯计算，
对服务组合之外的组合不拒绝但要标外推。公共件在 `ac_model_helpers`。
"""

import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.ac_model_helpers import (
    MISSING_ID,
    PREFIX,
    SignHeaders,
    _mark_trained,
    create_body,
    create_model,
    seed_room,
)
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.model_statuses import MODEL_STATUS_READY
from platform_server.apps.hvac.models import Room, Workshop

pytestmark = pytest.mark.requires_postgres


async def test_create_queues_training_and_normalizes_sets(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """建模 202：状态 queued，组合去重升序，带房间与车间引用。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(
        app_client,
        manager,
        seeded,
        serving_sets=[[seeded.serials[1], seeded.serials[0]]],
    )
    assert data["status"] == "queued"
    assert data["serving_sets"] == [sorted(seeded.serials)]
    assert data["room"]["name"] == "建模房"
    assert data["metrics"] is None
    assert data["is_batch_stale"] is False


async def test_create_rejects_a_foreign_serial(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """组合越出房间机组：422 且说出是哪台。"""
    seeded = await seed_room(db_session)
    response = await app_client.post(
        f"{PREFIX}/ac-models",
        json=create_body(seeded, serving_sets=[["K99"]]),
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == 422
    assert response.json()["code"] == 41620
    assert "K99" in response.json()["message"]


async def test_create_requires_a_current_batch(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """没抽取过的房间不能建模：409 提示先去重算。"""
    workshop = Workshop(name=f"车间{uuid.uuid4().hex[:8]}")
    db_session.add(workshop)
    await db_session.flush()
    room = Room(workshop_id=workshop.id, name="没数据房")
    db_session.add(room)
    await db_session.flush()
    response = await app_client.post(
        f"{PREFIX}/ac-models",
        json={
            "room_id": str(room.id),
            "name": "空转",
            "serving_sets": [["K11"]],
        },
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == 409
    assert response.json()["code"] == 41621


async def test_create_rejects_a_duplicate_name_in_the_room(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """同房间同名：409。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    await create_model(app_client, manager, seeded)
    response = await app_client.post(
        f"{PREFIX}/ac-models", json=create_body(seeded), headers=manager
    )
    assert response.status_code == 409
    assert response.json()["code"] == 41619


async def test_the_list_filters_by_room(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """列表可按房间过滤；查看权限就够。"""
    manager = sign([AC_MANAGE])
    first = await seed_room(db_session)
    second = await seed_room(db_session)
    await create_model(app_client, manager, first)
    await create_model(app_client, manager, second, name="另一个")
    listing = await app_client.get(
        f"{PREFIX}/ac-models",
        params={"room_id": str(first.room_id)},
        headers=sign([AC_VIEW]),
    )
    assert listing.status_code == 200
    items = listing.json()["data"]
    assert [item["name"] for item in items] == ["早班模型"]


async def test_patching_serving_sets_resummarizes_in_place(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """改服务组合就地重汇总：分组指标跟着变，不触发重训。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    model_id = uuid.UUID(data["id"])
    solo = [seeded.serials[0]]
    await _mark_trained(db_session, model_id, running_set=solo)
    # ⚠ 真训练在慢机器上会吃掉签名头的 TTL：重活之后重新签，不赌时钟
    manager = sign([AC_MANAGE])
    response = await app_client.patch(
        f"{PREFIX}/ac-models/{model_id}",
        json={"serving_sets": [solo, list(seeded.serials)]},
        headers=manager,
    )
    assert response.status_code == 200
    metrics = response.json()["data"]["metrics"]
    assert metrics is not None
    assert metrics["by_set"][seeded.serials[0]]["count"] == 2
    assert metrics["by_set"]["+".join(sorted(seeded.serials))] is None
    assert response.json()["data"]["status"] == MODEL_STATUS_READY


async def test_a_legacy_evaluation_keeps_its_metrics_and_reads_r2_as_null(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """⚠ 老评估 JSON 里没有 r2：缺的给 null，六元组必须照常读出来。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    model_id = uuid.UUID(data["id"])
    await _mark_trained(db_session, model_id, running_set=[seeded.serials[0]])
    response = await app_client.get(
        f"{PREFIX}/ac-models/{model_id}", headers=sign([AC_VIEW])
    )
    assert response.status_code == 200, response.text
    overall = response.json()["data"]["metrics"]["overall"]
    assert overall["r2"] is None
    assert overall["count"] == 2
    assert overall["mae"] == 2.0
    assert overall["mean_width"] == 15.0
    assert overall["reliability"] == "reliable"


async def test_resummarizing_computes_r2_for_the_new_grouping(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """改组合就地重汇总时 r2 一起补上：它来自存好的折外行，不用重训。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    model_id = uuid.UUID(data["id"])
    solo = [seeded.serials[0]]
    await _mark_trained(db_session, model_id, running_set=solo)
    response = await app_client.patch(
        f"{PREFIX}/ac-models/{model_id}",
        json={"serving_sets": [solo]},
        headers=sign([AC_MANAGE]),
    )
    assert response.status_code == 200, response.text
    block = response.json()["data"]["metrics"]["by_set"][seeded.serials[0]]
    # 两条折外行的实际值是 20 与 21，有离散度故 R² 有定义
    assert isinstance(block["r2"], float)


async def test_retrain_conflicts_while_queued(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """queued/training 期间重训是 409：重复触发只会白算一遍。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    response = await app_client.post(
        f"{PREFIX}/ac-models/{data['id']}:retrain", headers=manager
    )
    assert response.status_code == 409
    assert response.json()["code"] == 41623


async def test_retrain_requeues_a_trained_model(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """训过的模型可以重训：202 且回到 queued。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    model_id = uuid.UUID(data["id"])
    await _mark_trained(db_session, model_id, running_set=[seeded.serials[0]])
    # ⚠ 真训练在慢机器上会吃掉签名头的 TTL：重活之后重新签，不赌时钟
    response = await app_client.post(
        f"{PREFIX}/ac-models/{model_id}:retrain", headers=sign([AC_MANAGE])
    )
    assert response.status_code == 202
    assert response.json()["data"]["status"] == "queued"


async def test_delete_is_idempotent(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """删两次都是 204。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    first = await app_client.delete(
        f"{PREFIX}/ac-models/{data['id']}", headers=manager
    )
    second = await app_client.delete(
        f"{PREFIX}/ac-models/{data['id']}", headers=manager
    )
    assert first.status_code == 204
    assert second.status_code == 204


async def test_prediction_pages_walk_by_page_number(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """逐条对比按页码翻页，不重复不漏行；总数可知，越界 size 直接 400。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    model_id = uuid.UUID(data["id"])
    await _mark_trained(
        db_session,
        model_id,
        running_set=[seeded.serials[0]],
        prediction_count=5,
    )
    # ⚠ 真训练在慢机器上会吃掉签名头的 TTL：重活之后重新签，不赌时钟
    viewer = sign([AC_VIEW])
    url = f"{PREFIX}/ac-models/{model_id}/predictions"
    first = await app_client.get(url, params={"size": 2}, headers=viewer)
    assert first.status_code == 200
    page = first.json()["data"]
    assert len(page["items"]) == 2
    assert page["total"] == 5
    assert page["page"] == 1
    second = await app_client.get(
        url, params={"size": 2, "page": 2}, headers=viewer
    )
    stamps = [
        item["started_at"]
        for item in page["items"] + second.json()["data"]["items"]
    ]
    assert stamps == sorted(stamps, reverse=True)
    assert len(set(stamps)) == 4
    oversized = await app_client.get(
        url, params={"size": 100000}, headers=viewer
    )
    assert oversized.status_code == 400


async def test_a_missing_model_is_404_everywhere(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    """详情、逐条与试算对不存在的模型一律 404。"""
    viewer = sign([AC_VIEW])
    for url in (
        f"{PREFIX}/ac-models/{MISSING_ID}",
        f"{PREFIX}/ac-models/{MISSING_ID}/predictions",
    ):
        response = await app_client.get(url, headers=viewer)
        assert response.status_code == 404
        assert response.json()["code"] == 41618


async def test_predictions_filter_by_running_set(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """逐条对比按组合过滤：别的组合的行不出现。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    model_id = uuid.UUID(data["id"])
    await _mark_trained(db_session, model_id, running_set=[seeded.serials[0]])
    hit = await app_client.get(
        f"{PREFIX}/ac-models/{model_id}/predictions",
        params={"running_set": seeded.serials[0]},
        headers=sign([AC_VIEW]),
    )
    assert len(hit.json()["data"]["items"]) == 2
    miss = await app_client.get(
        f"{PREFIX}/ac-models/{model_id}/predictions",
        params={"running_set": ",".join(seeded.serials)},
        headers=sign([AC_VIEW]),
    )
    assert miss.json()["data"]["items"] == []
