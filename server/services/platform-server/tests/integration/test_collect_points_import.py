"""点位导入按源与编码更新，空白保留且整批原子。"""

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
IMPORT = f"{POINTS}:import"


def blank_import_item() -> dict[str, object]:
    """空白保留与明确布尔、数值混合的一行。"""
    return {
        "code": "outlet_temp",
        "name": "  ",
        "address": "",
        "unit": None,
        "description": "",
        "data_type": "",
        "sampling_interval_ms": "",
        "archive_retention_days": None,
        "archive_max_interval_ms": " ",
        "deadband": 0,
        "archive_enabled": False,
    }


async def test_import_updates_by_code_and_creates_without_replacing_identity(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    original = (await create_points(app_client, source["id"]))["items"][0]
    collect_fakes.plans.published.clear()
    response = await app_client.post(
        IMPORT,
        json={
            "source_id": source["id"],
            "items": [
                {"code": "outlet_temp", "address": "ns=3;s=moved"},
                point_item("new_temp"),
            ],
        },
    )
    assert response.status_code == 200, response.text
    result = payload(response)
    assert (result["created_count"], result["updated_count"]) == (1, 1)
    assert result["unchanged_count"] == 0
    updated = result["items"][0]
    assert updated["address"] == "ns=3;s=moved"
    for key in ("id", "node_key", "code", "created_at", "unit", "name"):
        assert updated[key] == original[key]
    assert collect_fakes.plans.published[-1][1]["reason"] == "point_changed"


async def test_empty_import_cells_preserve_values_but_false_and_zero_update(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    original = (
        await create_points(
            app_client,
            source["id"],
            point_item(
                description="设备温度", deadband=5, archive_retention_days=90
            ),
        )
    )["items"][0]
    collect_fakes.bus.sent.clear()
    response = await app_client.post(
        IMPORT,
        json={
            "source_id": source["id"],
            "items": [blank_import_item()],
        },
    )
    assert response.status_code == 200, response.text
    result = payload(response)
    updated = result["items"][0]
    assert updated["deadband"] == 0
    assert updated["archive_enabled"] is False
    for key in (
        "name",
        "address",
        "unit",
        "description",
        "data_type",
        "sampling_interval_ms",
        "archive_max_interval_ms",
        "archive_retention_days",
    ):
        assert updated[key] == original[key]
    assert result["address_checks"] == []
    assert collect_fakes.bus.sent == []


async def test_import_does_not_update_the_same_code_in_another_source(
    app_client: httpx.AsyncClient,
) -> None:
    first = await create_source(app_client, code="first")
    second = await create_source(app_client, code="second")
    await create_points(app_client, first["id"])
    await create_points(app_client, second["id"])
    response = await app_client.post(
        IMPORT,
        json={
            "source_id": first["id"],
            "items": [{"code": "outlet_temp", "name": "改名"}],
        },
    )
    assert response.status_code == 200
    listed = await app_client.get(POINTS, params={"source_id": second["id"]})
    assert payload(listed)["items"][0]["name"] == "出口温度"


async def test_missing_new_point_fields_roll_back_other_updates(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"])
    response = await app_client.post(
        IMPORT,
        json={
            "source_id": source["id"],
            "items": [
                {"code": "outlet_temp", "name": "不能保存"},
                {"code": "new"},
            ],
        },
    )
    assert response.status_code == 400
    assert envelope(response)["details"][0]["field"] == "items[1].name"
    listed = payload(
        await app_client.get(POINTS, params={"source_id": source["id"]})
    )
    assert listed["total"] == 1
    assert listed["items"][0]["name"] == "出口温度"


async def test_rejected_address_rolls_back_the_entire_import(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"])
    collect_fakes.bus.replies[ACTION_VALIDATE] = {
        "status": "ok",
        "data": {"results": [{"address": "bad", "is_valid": False}]},
    }
    response = await app_client.post(
        IMPORT,
        json={
            "source_id": source["id"],
            "items": [
                {"code": "outlet_temp", "name": "不能保存"},
                point_item("new", address="bad"),
            ],
        },
    )
    assert response.status_code == 400
    assert envelope(response)["details"][0]["field"] == "items[1].address"
    listed = payload(
        await app_client.get(POINTS, params={"source_id": source["id"]})
    )
    assert listed["total"] == 1
    assert listed["items"][0]["name"] == "出口温度"


async def test_import_can_skip_existing_and_reject_duplicate_file_codes(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    await create_points(app_client, source["id"])
    response = await app_client.post(
        IMPORT,
        json={
            "source_id": source["id"],
            "is_skipping_existing": True,
            "items": [{"code": "outlet_temp", "name": "不更新"}],
        },
    )
    assert response.status_code == 200
    assert payload(response)["unchanged_count"] == 1
    assert payload(response)["items"][0]["name"] == "出口温度"
    duplicate = await app_client.post(
        IMPORT,
        json={
            "source_id": source["id"],
            "items": [
                {"code": "outlet_temp"},
                {"code": "outlet_temp"},
            ],
        },
    )
    assert duplicate.status_code == 400
    assert envelope(duplicate)["details"][0]["field"] == "items[1].code"


async def test_import_no_op_and_idempotent_replay(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    body = {"source_id": source["id"], "items": [point_item()]}
    headers = {"Idempotency-Key": "point-import-test"}
    first = await app_client.post(IMPORT, json=body, headers=headers)
    repeated = await app_client.post(IMPORT, json=body, headers=headers)
    assert first.status_code == repeated.status_code == 200
    assert payload(first) == payload(repeated)
    unchanged = await app_client.post(
        IMPORT,
        json={"source_id": source["id"], "items": [{"code": "outlet_temp"}]},
    )
    assert payload(unchanged)["unchanged_count"] == 1
    assert (
        payload(unchanged)["items"][0]["updated_at"]
        == payload(first)["items"][0]["updated_at"]
    )
