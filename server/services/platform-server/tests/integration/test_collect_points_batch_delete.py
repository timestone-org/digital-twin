"""批量删点的对外契约：整批全删或全不删，且计划变更只广播一次。

守的是「部分成功不许发生」——一半删掉一半留下时，界面上剩下的那几条看着像
「没勾中」，用户会再勾一次再删一次，永远删不掉也永远看不出原因。
"""

import httpx
import pytest
from conftest import CollectFakes

from integration.collect_helpers import (
    POINTS,
    create_points,
    create_source,
    envelope,
    payload,
    point_item,
)

pytestmark = pytest.mark.requires_postgres

BATCH_DELETE = f"{POINTS}:batch-delete"
MISSING_ID = "0192f0c0-0000-7000-8000-0000000b47c4"


async def remaining_codes(
    client: httpx.AsyncClient, source_id: str
) -> list[str]:
    """这个数据源下还剩哪些点位编码。

    Args: client, source_id。
    """
    listed = await client.get(POINTS, params={"source_id": source_id})
    return [item["code"] for item in payload(listed)["items"]]


async def test_a_whole_selection_goes_in_one_call(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    batch = await create_points(
        app_client,
        source["id"],
        point_item("alpha"),
        point_item("beta"),
        point_item("gamma"),
    )
    doomed = [item["id"] for item in batch["items"][:2]]
    response = await app_client.post(BATCH_DELETE, json={"point_ids": doomed})
    assert response.status_code == 204
    assert await remaining_codes(app_client, source["id"]) == ["gamma"]


async def test_the_same_id_twice_deletes_it_once(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    batch = await create_points(
        app_client, source["id"], point_item("alpha"), point_item("beta")
    )
    doomed = batch["items"][0]["id"]
    response = await app_client.post(
        BATCH_DELETE, json={"point_ids": [doomed, doomed]}
    )
    assert response.status_code == 204
    assert await remaining_codes(app_client, source["id"]) == ["beta"]


async def test_one_missing_id_leaves_the_whole_batch_alone(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 这一条守的是「别人刚删掉其中一条」这个真实场景：静默跳过会让人以为
    # 自己删的是另一条，而那一条还好好地在表里
    source = await create_source(app_client)
    batch = await create_points(
        app_client, source["id"], point_item("alpha"), point_item("beta")
    )
    response = await app_client.post(
        BATCH_DELETE,
        json={"point_ids": [batch["items"][0]["id"], MISSING_ID]},
    )
    assert response.status_code == 404
    assert envelope(response)["code"] == 41102
    assert await remaining_codes(app_client, source["id"]) == ["alpha", "beta"]


async def test_an_empty_selection_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(BATCH_DELETE, json={"point_ids": []})
    assert response.status_code == 400


async def test_a_selection_past_the_batch_limit_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        BATCH_DELETE, json={"point_ids": [MISSING_ID] * 201}
    )
    assert response.status_code == 400


async def test_the_whole_batch_broadcasts_one_plan_change(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    # ⚠ 一批一次，不是一条一次：逐条广播会让采集侧为一次批量删除重拉 N 遍计划
    source = await create_source(app_client)
    batch = await create_points(
        app_client, source["id"], point_item("alpha"), point_item("beta")
    )
    collect_fakes.plans.published.clear()
    response = await app_client.post(
        BATCH_DELETE,
        json={"point_ids": [item["id"] for item in batch["items"]]},
    )
    assert response.status_code == 204
    reasons = [item[1]["reason"] for item in collect_fakes.plans.published]
    assert reasons == ["point_changed"]
