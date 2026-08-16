"""数据源面的对外契约：真实状态码、凭据不回显、删除守卫、计划广播。

守的是「HTTP 状态码必须真实」与「口令绝不出现在任何出参里」。
"""

import httpx
import pytest
from conftest import CollectFakes

from integration.collect_helpers import (
    POINTS,
    SOURCES,
    create_points,
    create_source,
    envelope,
    payload,
    source_body,
)

pytestmark = pytest.mark.requires_postgres


async def test_a_new_source_answers_201_with_a_location(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(SOURCES, json=source_body())
    assert response.status_code == 201
    created = payload(response)
    assert response.headers["Location"] == f"{SOURCES}/{created['id']}"
    assert created["code"] == "line-1"
    assert created["point_count"] == 0


async def test_a_credential_never_comes_back(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_source(app_client, credential="s3cr3t-p@ss")
    assert created["has_credential"] is True
    assert "credential" not in created
    assert "s3cr3t" not in httpx.Response(200, json=created).text


async def test_a_source_without_a_credential_says_so(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_source(app_client)
    assert created["has_credential"] is False


async def test_a_duplicate_code_is_a_conflict(
    app_client: httpx.AsyncClient,
) -> None:
    await create_source(app_client)
    response = await app_client.post(SOURCES, json=source_body())
    assert response.status_code == 409
    assert envelope(response)["code"] == 41103


async def test_an_unknown_protocol_is_refused_by_the_schema(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        SOURCES, json=source_body(protocol="modbus")
    )
    assert response.status_code == 400


async def test_a_too_fast_poll_interval_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        SOURCES, json=source_body(poll_interval_ms=10)
    )
    assert response.status_code == 400


async def test_an_unknown_source_reads_back_404(
    app_client: httpx.AsyncClient,
) -> None:
    missing = "0192f0c0-0000-7000-8000-00000000dead"
    response = await app_client.get(f"{SOURCES}/{missing}")
    assert response.status_code == 404
    assert envelope(response)["code"] == 41101


async def test_a_patch_leaves_untouched_fields_alone(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_source(app_client)
    response = await app_client.patch(
        f"{SOURCES}/{created['id']}", json={"name": "一号线 PLC（备）"}
    )
    assert response.status_code == 200
    updated = payload(response)
    assert updated["name"] == "一号线 PLC（备）"
    assert updated["endpoint"] == created["endpoint"]
    assert updated["read_mode"] == created["read_mode"]


async def test_a_patch_cannot_rename_the_code(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_source(app_client)
    response = await app_client.patch(
        f"{SOURCES}/{created['id']}", json={"code": "line-2"}
    )
    assert response.status_code == 400


async def test_clearing_the_credential_flips_the_flag(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_source(app_client, credential="s3cr3t")
    response = await app_client.patch(
        f"{SOURCES}/{created['id']}", json={"credential": None}
    )
    assert payload(response)["has_credential"] is False


async def test_an_explicit_null_on_a_non_nullable_field_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_source(app_client)
    response = await app_client.patch(
        f"{SOURCES}/{created['id']}", json={"name": None}
    )
    assert response.status_code == 400


async def test_deleting_an_empty_source_answers_204(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_source(app_client)
    response = await app_client.delete(f"{SOURCES}/{created['id']}")
    assert response.status_code == 204
    assert response.content == b""


async def test_deleting_a_source_that_still_has_points_is_a_conflict(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_source(app_client)
    await create_points(app_client, created["id"])
    response = await app_client.delete(f"{SOURCES}/{created['id']}")
    assert response.status_code == 409
    assert envelope(response)["code"] == 41106


async def test_the_list_counts_the_points_of_each_source(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_source(app_client)
    await create_points(app_client, created["id"])
    response = await app_client.get(SOURCES)
    listed = payload(response)
    found = [item for item in listed["items"] if item["id"] == created["id"]]
    assert found[0]["point_count"] == 1


async def test_the_list_filters_by_keyword(
    app_client: httpx.AsyncClient,
) -> None:
    await create_source(app_client, code="line-1", name="一号线")
    await create_source(app_client, code="line-2", name="二号线")
    response = await app_client.get(SOURCES, params={"q": "line-2"})
    codes = [item["code"] for item in payload(response)["items"]]
    assert codes == ["line-2"]


async def test_the_list_filters_by_protocol(
    app_client: httpx.AsyncClient,
) -> None:
    await create_source(app_client)
    response = await app_client.get(SOURCES, params={"protocol": "modbus"})
    assert payload(response)["items"] == []


async def test_a_page_size_over_the_cap_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(SOURCES, params={"size": 500})
    assert response.status_code == 400


async def test_creating_a_source_broadcasts_a_plan_change(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    await create_source(app_client)
    channels = [item[0] for item in collect_fakes.plans.published]
    reasons = [item[1]["reason"] for item in collect_fakes.plans.published]
    assert channels == ["collect:plan:changed"]
    assert reasons == ["source_changed"]


async def test_a_rejected_create_broadcasts_nothing(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    await create_source(app_client)
    collect_fakes.plans.published.clear()
    await app_client.post(SOURCES, json=source_body())
    assert collect_fakes.plans.published == []


async def test_the_same_idempotency_key_creates_only_one_source(
    app_client: httpx.AsyncClient,
) -> None:
    headers = {"Idempotency-Key": "create-source-1"}
    first = await app_client.post(SOURCES, json=source_body(), headers=headers)
    second = await app_client.post(SOURCES, json=source_body(), headers=headers)
    assert first.status_code == 201
    assert second.status_code == 201
    assert payload(first)["id"] == payload(second)["id"]


async def test_a_source_reads_back_by_id(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_source(app_client)
    response = await app_client.get(f"{SOURCES}/{created['id']}")
    assert response.status_code == 200
    assert payload(response)["code"] == created["code"]


async def test_the_list_filters_by_enabled_state(
    app_client: httpx.AsyncClient,
) -> None:
    await create_source(app_client, code="line-1", is_enabled=True)
    await create_source(app_client, code="line-2", is_enabled=False)
    response = await app_client.get(SOURCES, params={"is_enabled": "false"})
    codes = [item["code"] for item in payload(response)["items"]]
    assert codes == ["line-2"]


async def test_description_and_username_round_trip(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(
        app_client, description="一号车间的主 PLC", username="operator"
    )
    assert source["description"] == "一号车间的主 PLC"
    assert source["username"] == "operator"
    read = await app_client.get(f"{SOURCES}/{source['id']}")
    assert payload(read)["description"] == "一号车间的主 PLC"
    assert payload(read)["username"] == "operator"


async def test_a_null_clears_the_description_and_username(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(
        app_client, description="备注", username="operator"
    )
    response = await app_client.patch(
        f"{SOURCES}/{source['id']}",
        json={"description": None, "username": None},
    )
    assert response.status_code == 200
    assert payload(response)["description"] is None
    assert payload(response)["username"] is None


async def test_force_delete_takes_the_points_with_the_source(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 默认拒删非空源；force 让点位随外键 CASCADE 一起走
    source = await create_source(app_client)
    await create_points(app_client, source["id"])
    refused = await app_client.delete(f"{SOURCES}/{source['id']}")
    assert refused.status_code == 409
    forced = await app_client.delete(
        f"{SOURCES}/{source['id']}", params={"force": "true"}
    )
    assert forced.status_code == 204
    listed = await app_client.get(POINTS, params={"source_id": source["id"]})
    assert payload(listed)["items"] == []
