"""点位面的对外契约：批量建点、编码撞车、寻址串校验的三档结论。

守的是「没校验成绝不当作通过」与「`code` 是身份不许改名」两条口径。
"""

import httpx
import pytest
from conftest import CollectFakes
from unit.collect_fakes import ACTION_VALIDATE

from integration.collect_helpers import (
    POINTS,
    create_points,
    create_source,
    envelope,
    payload,
    point_item,
)

pytestmark = pytest.mark.requires_postgres


def accept_all(collect_fakes: CollectFakes, *addresses: str) -> None:
    """让假的采集侧把这些寻址串都判为合法。

    Args: collect_fakes, addresses。
    """
    collect_fakes.bus.replies[ACTION_VALIDATE] = {
        "status": "ok",
        "data": {
            "results": [
                {"address": address, "is_valid": True} for address in addresses
            ]
        },
    }


async def test_a_batch_of_one_answers_201_with_a_location(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    response = await app_client.post(
        POINTS, json={"source_id": source["id"], "items": [point_item()]}
    )
    assert response.status_code == 201
    created = payload(response)["items"][0]
    assert response.headers["Location"] == f"{POINTS}/{created['id']}"


async def test_a_batch_of_many_gives_no_location(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    response = await app_client.post(
        POINTS,
        json={
            "source_id": source["id"],
            "items": [point_item("a"), point_item("b")],
        },
    )
    assert response.status_code == 201
    assert "Location" not in response.headers


async def test_a_point_carries_its_node_key(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    assert batch["items"][0]["node_key"] == f"{source['id']}:outlet_temp"


async def test_an_unanswered_address_is_reported_unverified(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    check = batch["address_checks"][0]
    assert check["address"] == "ns=2;s=outlet_temp"
    assert check["status"] == "unverified"
    assert check["detail"] is not None


async def test_an_accepted_address_is_reported_passed(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    accept_all(collect_fakes, "ns=2;s=outlet_temp")
    batch = await create_points(app_client, source["id"])
    assert batch["address_checks"][0]["status"] == "passed"


async def test_a_rejected_address_blocks_the_whole_batch(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    collect_fakes.bus.replies[ACTION_VALIDATE] = {
        "status": "ok",
        "data": {
            "results": [
                {"address": "ns=2;s=a", "is_valid": True},
                {
                    "address": "ns=2;s=b",
                    "is_valid": False,
                    "detail": "BadNodeIdUnknown",
                },
            ]
        },
    }
    response = await app_client.post(
        POINTS,
        json={
            "source_id": source["id"],
            "items": [point_item("a"), point_item("b")],
        },
    )
    assert response.status_code == 400
    body = envelope(response)
    assert body["code"] == 41111
    assert body["details"][0]["field"] == "items[1].address"
    listed = await app_client.get(POINTS, params={"source_id": source["id"]})
    assert payload(listed)["items"] == []


async def test_a_duplicate_code_inside_one_batch_points_at_it(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    response = await app_client.post(
        POINTS,
        json={
            "source_id": source["id"],
            "items": [point_item("temp"), point_item("temp")],
        },
    )
    assert response.status_code == 400
    assert envelope(response)["details"][0]["field"] == "items[1].code"


async def test_a_code_already_taken_by_the_source_is_a_conflict(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"])
    response = await app_client.post(
        POINTS, json={"source_id": source["id"], "items": [point_item()]}
    )
    assert response.status_code == 409
    assert envelope(response)["code"] == 41104


async def test_the_same_code_under_another_source_is_allowed(
    app_client: httpx.AsyncClient,
) -> None:
    first = await create_source(app_client, code="line-1")
    second = await create_source(app_client, code="line-2")
    await create_points(app_client, first["id"])
    batch = await create_points(app_client, second["id"])
    assert batch["items"][0]["code"] == "outlet_temp"


async def test_points_for_an_unknown_source_read_back_404(
    app_client: httpx.AsyncClient,
) -> None:
    missing = "0192f0c0-0000-7000-8000-00000000dead"
    response = await app_client.post(
        POINTS, json={"source_id": missing, "items": [point_item()]}
    )
    assert response.status_code == 404
    assert envelope(response)["code"] == 41101


async def test_an_empty_batch_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    response = await app_client.post(
        POINTS, json={"source_id": source["id"], "items": []}
    )
    assert response.status_code == 400


async def test_a_patch_without_an_address_skips_the_field_round_trip(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    collect_fakes.bus.sent.clear()
    response = await app_client.patch(
        f"{POINTS}/{batch['items'][0]['id']}", json={"name": "出口温度（新）"}
    )
    assert response.status_code == 200
    saved = payload(response)
    assert saved["point"]["name"] == "出口温度（新）"
    assert saved["address_check"] is None
    assert collect_fakes.bus.sent == []


async def test_a_patched_address_is_checked_again(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    accept_all(collect_fakes, "ns=3;s=moved")
    response = await app_client.patch(
        f"{POINTS}/{batch['items'][0]['id']}", json={"address": "ns=3;s=moved"}
    )
    saved = payload(response)
    assert saved["point"]["address"] == "ns=3;s=moved"
    assert saved["address_check"]["status"] == "passed"


async def test_a_rejected_new_address_leaves_the_point_untouched(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    point_id = batch["items"][0]["id"]
    collect_fakes.bus.replies[ACTION_VALIDATE] = {
        "status": "ok",
        "data": {"results": [{"address": "ns=9;s=bad", "is_valid": False}]},
    }
    response = await app_client.patch(
        f"{POINTS}/{point_id}", json={"address": "ns=9;s=bad"}
    )
    assert response.status_code == 400
    listed = await app_client.get(POINTS, params={"source_id": source["id"]})
    assert payload(listed)["items"][0]["address"] == "ns=2;s=outlet_temp"


async def test_a_patch_cannot_rename_the_code(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    response = await app_client.patch(
        f"{POINTS}/{batch['items'][0]['id']}", json={"code": "renamed"}
    )
    assert response.status_code == 400


async def test_deleting_an_unbound_point_answers_204(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    response = await app_client.delete(f"{POINTS}/{batch['items'][0]['id']}")
    assert response.status_code == 204


async def test_deleting_an_unknown_point_reads_back_404(
    app_client: httpx.AsyncClient,
) -> None:
    missing = "0192f0c0-0000-7000-8000-00000000beef"
    response = await app_client.delete(f"{POINTS}/{missing}")
    assert response.status_code == 404
    assert envelope(response)["code"] == 41102


async def test_the_list_searches_by_name_and_by_code(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    await create_points(
        app_client,
        source["id"],
        point_item("outlet_temp", name="出口温度"),
        point_item("inlet_temp", name="进口温度"),
    )
    by_code = await app_client.get(POINTS, params={"q": "inlet"})
    assert [item["code"] for item in payload(by_code)["items"]] == [
        "inlet_temp"
    ]
    by_name = await app_client.get(POINTS, params={"q": "出口"})
    assert [item["code"] for item in payload(by_name)["items"]] == [
        "outlet_temp"
    ]


async def test_the_list_is_ordered_the_same_way_twice(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    await create_points(
        app_client,
        source["id"],
        point_item("zeta"),
        point_item("alpha"),
        point_item("mid"),
    )
    first = await app_client.get(POINTS, params={"source_id": source["id"]})
    second = await app_client.get(POINTS, params={"source_id": source["id"]})
    # ⚠ 比 data 段而不是整个响应：trace_id 每次都不同，那是设计如此
    assert payload(first) == payload(second)
    assert [item["code"] for item in payload(first)["items"]] == [
        "alpha",
        "mid",
        "zeta",
    ]


async def test_creating_points_broadcasts_a_plan_change(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    collect_fakes.plans.published.clear()
    await create_points(app_client, source["id"])
    reasons = [item[1]["reason"] for item in collect_fakes.plans.published]
    assert reasons == ["point_changed"]
