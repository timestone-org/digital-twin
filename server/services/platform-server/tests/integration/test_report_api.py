"""报告管理、试算、幂等及权限在真实 Postgres 上的完整装配。"""

import uuid
from datetime import UTC, datetime

import httpx
import pytest

from integration.dataset_helpers import create_column, create_table, data_of
from platform_server.apps.dataset.models import DatasetRecord
from platform_server.apps.report.models import (
    ReportRender,
)

pytestmark = pytest.mark.requires_postgres
PREFIX = "/api/v1/platform"


async def test_report_template_version_and_render_idempotency(
    app_client: httpx.AsyncClient,
):
    body = {
        "code": "report_" + uuid.uuid4().hex,
        "name": "能耗月报",
        "doc_json": {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "正文"}],
                }
            ],
        },
    }
    created = await app_client.post(f"{PREFIX}/report-templates", json=body)
    assert created.status_code == 201, created.text
    report = data_of(created)
    template_id = report["id"]
    assert created.headers["location"].endswith(template_id)
    update = {"name": "修改后的月报", "expected_version": report["row_version"]}
    saved = await app_client.put(
        f"{PREFIX}/report-templates/{template_id}", json=update
    )
    assert saved.status_code == 200, saved.text
    conflict = await app_client.put(
        f"{PREFIX}/report-templates/{template_id}", json=update
    )
    assert conflict.status_code == 409
    payload = {"template_id": template_id, "period": "2026-08"}
    headers = {"Idempotency-Key": uuid.uuid4().hex}
    first = await app_client.post(
        f"{PREFIX}/report-renders", json=payload, headers=headers
    )
    repeated = await app_client.post(
        f"{PREFIX}/report-renders", json=payload, headers=headers
    )
    assert first.status_code == repeated.status_code == 202, first.text
    assert data_of(first)["id"] == data_of(repeated)["id"]
    different = await app_client.post(
        f"{PREFIX}/report-renders",
        json={**payload, "period": "2026-07"},
        headers=headers,
    )
    assert different.status_code == 409


async def test_report_trial_reads_current_ledger_contract(
    app_client: httpx.AsyncClient,
):
    table = await create_table(
        app_client, code="energy_" + uuid.uuid4().hex, name="能耗"
    )
    await create_column(app_client, table["id"], key="energy", name="能耗")
    body = {
        "code": "report_" + uuid.uuid4().hex,
        "name": "月报",
        "metrics": [
            {
                "name": "本期",
                "table": table["code"],
                "key": "energy",
                "mode": "window_agg",
                "agg": "count",
            }
        ],
    }
    created = await app_client.post(f"{PREFIX}/report-templates", json=body)
    assert created.status_code == 201, created.text
    response = await app_client.post(
        f"{PREFIX}/report-templates/{data_of(created)['id']}:preview",
        json={"period": "2026-08"},
    )
    assert response.status_code == 200, response.text
    result = data_of(response)
    assert result["metrics"][0]["value"] == "0"
    assert result["timezone"] == "Asia/Shanghai"
    assert result["metrics"][0]["since"] == "2026-07-31T16:00:00.000Z"


async def test_report_download_requires_render_permission(
    app_client: httpx.AsyncClient, sign
):
    response = await app_client.get(
        f"{PREFIX}/report-renders/{uuid.uuid4()}/files",
        headers=sign(codes=("report:view",)),
    )
    assert response.status_code == 403


async def test_template_list_validation_delete_and_disabled_generation(
    app_client,
):
    created = await app_client.post(
        f"{PREFIX}/report-templates",
        json={
            "code": "disabled_" + uuid.uuid4().hex,
            "name": "停用报告",
            "is_enabled": False,
        },
    )
    template_id = data_of(created)["id"]
    listed = await app_client.get(f"{PREFIX}/report-templates")
    assert template_id in [item["id"] for item in data_of(listed)["items"]]
    details = await app_client.get(f"{PREFIX}/report-templates/{template_id}")
    assert data_of(details)["is_enabled"] is False
    generated = await app_client.post(
        f"{PREFIX}/report-renders",
        json={"template_id": template_id, "period": "2026-08"},
    )
    assert generated.status_code == 400
    invalid = await app_client.post(
        f"{PREFIX}/report-templates:validate",
        json={"name": "错误报告", "doc_json": {"type": "paragraph"}},
    )
    assert data_of(invalid)["is_valid"] is False
    removed = await app_client.delete(
        f"{PREFIX}/report-templates/{template_id}"
    )
    assert removed.status_code == 204
    assert (
        await app_client.delete(f"{PREFIX}/report-templates/{template_id}")
    ).status_code == 204
    assert (
        await app_client.get(f"{PREFIX}/report-templates/{template_id}")
    ).status_code == 404


async def test_schedule_management_and_runtime(app_client):
    created = await app_client.post(
        f"{PREFIX}/report-templates",
        json={"code": "schedule_" + uuid.uuid4().hex, "name": "定时报告"},
    )
    template_id = data_of(created)["id"]
    rule = await app_client.post(
        f"{PREFIX}/report-schedules",
        json={"template_id": template_id, "name": "月报"},
    )
    assert rule.status_code == 201, rule.text
    schedule_id = data_of(rule)["id"]
    blocked = await app_client.delete(
        f"{PREFIX}/report-templates/{template_id}"
    )
    assert blocked.status_code == 409
    listed = await app_client.get(f"{PREFIX}/report-schedules")
    assert schedule_id in [item["id"] for item in data_of(listed)["items"]]
    updated = await app_client.put(
        f"{PREFIX}/report-schedules/{schedule_id}",
        json={"name": "暂停月报", "is_enabled": False, "expected_version": 1},
    )
    assert data_of(updated)["is_enabled"] is False
    conflict = await app_client.put(
        f"{PREFIX}/report-schedules/{schedule_id}",
        json={"name": "冲突", "expected_version": 1},
    )
    assert conflict.status_code == 409
    runtime = await app_client.get(f"{PREFIX}/report-renders/runtime/settings")
    assert data_of(runtime)["is_schedule_enabled"] is False
    assert (
        await app_client.delete(f"{PREFIX}/report-schedules/{schedule_id}")
    ).status_code == 204
    assert (
        await app_client.delete(f"{PREFIX}/report-schedules/{schedule_id}")
    ).status_code == 204


async def test_render_cursor_and_download_before_completion(app_client):
    created = await app_client.post(
        f"{PREFIX}/report-templates",
        json={"code": "pages_" + uuid.uuid4().hex, "name": "报告"},
    )
    template_id = data_of(created)["id"]
    for period in ("2026-07", "2026-08"):
        response = await app_client.post(
            f"{PREFIX}/report-renders",
            json={"template_id": template_id, "period": period},
        )
        assert response.status_code == 202
    first = data_of(
        await app_client.get(
            f"{PREFIX}/report-renders",
            params={"template_id": template_id, "limit": 1},
        )
    )
    assert first["has_more"]
    second = data_of(
        await app_client.get(
            f"{PREFIX}/report-renders",
            params={
                "template_id": template_id,
                "limit": 1,
                "after": first["next"],
            },
        )
    )
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert not second["has_more"]
    download = await app_client.get(
        f"{PREFIX}/report-renders/{first['items'][0]['id']}/files"
    )
    assert download.status_code == 409
    assert (
        await app_client.get(f"{PREFIX}/report-renders/{uuid.uuid4()}")
    ).status_code == 404


async def test_preview_uses_effective_values_and_excludes_next_period(
    app_context,
):
    client, session = app_context.client, app_context.session
    table = await create_table(
        client, code="values_" + uuid.uuid4().hex, name="能耗"
    )
    await create_column(client, table["id"], key="energy", name="能耗")
    await seed_effective_values(session, table["id"])
    template = await create_data_report(client, table["code"])
    response = await client.post(
        f"{PREFIX}/report-templates/{template}:preview",
        json={"period": "2026-08"},
    )
    assert response.status_code == 200, response.text
    result = data_of(response)
    assert result["metrics"][0]["value"] == "55"
    assert result["metrics"][0]["value_kind"] == "number"
    assert result["nodes"]["content.0"]["rows"][-1] == ["合计", "35.00"]
    assert result["nodes"]["content.0"]["is_truncated"] is True
    assert [
        point["value"]
        for point in result["nodes"]["content.1"]["series"][0]["points"]
    ] == ["20", "35"]


async def create_data_report(client, code):
    response = await client.post(
        f"{PREFIX}/report-templates",
        json={
            "code": "data_" + uuid.uuid4().hex,
            "name": "数据报告",
            "metrics": [
                {"name": "能耗", "table": code, "key": "energy", "agg": "sum"}
            ],
            "doc_json": {
                "type": "doc",
                "content": [
                    {
                        "type": "dsTable",
                        "attrs": {
                            "table": code,
                            "keys": ["energy"],
                            "limit": 1,
                            "summary": "sum",
                        },
                    },
                    {
                        "type": "dsChart",
                        "attrs": {
                            "kind": "bar",
                            "series": [
                                {"name": "能耗", "table": code, "key": "energy"}
                            ],
                        },
                    },
                ],
            },
        },
    )
    assert response.status_code == 201, response.text
    return data_of(response)["id"]


async def test_missing_metric_source_is_explicit_and_propagates(app_client):
    response = await app_client.post(
        f"{PREFIX}/report-templates",
        json={
            "code": "missing_" + uuid.uuid4().hex,
            "name": "报告",
            "metrics": [
                {"name": "原值", "table": "not_found", "key": "x"},
                {"name": "派生", "mode": "expr", "expr": "{原值}+1"},
            ],
            "doc_json": {
                "type": "doc",
                "content": [
                    {"type": "metricRef", "attrs": {"expr": "{派生}"}},
                    {"type": "dsChart", "attrs": {"series": []}},
                    {
                        "type": "dsTable",
                        "attrs": {"table": "not_found", "keys": ["x"]},
                    },
                ],
            },
        },
    )
    result = data_of(
        await app_client.post(
            f"{PREFIX}/report-templates/{data_of(response)['id']}:preview",
            json={"period": "2026-08"},
        )
    )
    assert result["is_valid"] is False
    assert result["metrics"][0]["value"] is None
    assert result["metrics"][1]["error"] == "所引用指标取数失败"
    assert len(result["warnings"]) >= 3


async def seed_effective_values(session, table_id):
    session.add_all(
        [
            DatasetRecord(
                table_id=uuid.UUID(table_id),
                ts=datetime(2026, 8, 1, tzinfo=UTC),
                row_id=uuid.uuid4(),
                values_json={"energy": "10"},
                overrides_json={"energy": {"v": "20"}},
                source="manual",
            ),
            DatasetRecord(
                table_id=uuid.UUID(table_id),
                ts=datetime(2026, 8, 2, tzinfo=UTC),
                row_id=uuid.uuid4(),
                values_json={"energy": "30"},
                computed_json={"energy": "35"},
                source="manual",
            ),
            DatasetRecord(
                table_id=uuid.UUID(table_id),
                ts=datetime(2026, 8, 31, 16, tzinfo=UTC),
                row_id=uuid.uuid4(),
                values_json={"energy": "999"},
                source="manual",
            ),
        ]
    )
    await session.commit()


async def test_latest_anchor_is_explicitly_marked_stale(app_context):
    client, session = app_context.client, app_context.session
    table = await create_table(
        client, code="stale_" + uuid.uuid4().hex, name="能耗"
    )
    await create_column(client, table["id"], key="energy", name="能耗")
    await seed_effective_values(session, table["id"])
    template_id = await create_data_report(client, table["code"])
    draft = {
        "name": "最新数据报告",
        "metrics": [
            {
                "name": "最新",
                "table": table["code"],
                "key": "energy",
                "anchor": "latest",
                "agg": "sum",
            }
        ],
    }
    response = await client.post(
        f"{PREFIX}/report-templates/{template_id}:preview",
        json={"period": "2026-10", "draft": draft},
    )
    result = data_of(response)
    assert result["metrics"][0]["value"] == "999"
    assert result["metrics"][0]["is_stale"] is True
    assert any("较早" in warning for warning in result["warnings"])


async def test_idempotent_replay_survives_template_disable(app_client):
    created = data_of(
        await app_client.post(
            f"{PREFIX}/report-templates",
            json={"code": "replay_" + uuid.uuid4().hex, "name": "报告"},
        )
    )
    payload = {"template_id": created["id"], "period": "2026-08"}
    headers = {"Idempotency-Key": uuid.uuid4().hex}
    first = await app_client.post(
        f"{PREFIX}/report-renders", json=payload, headers=headers
    )
    await app_client.put(
        f"{PREFIX}/report-templates/{created['id']}",
        json={"name": "已停用", "is_enabled": False, "expected_version": 1},
    )
    replay = await app_client.post(
        f"{PREFIX}/report-renders", json=payload, headers=headers
    )
    assert replay.status_code == 202
    assert data_of(replay) == data_of(first)


async def test_queue_backpressure_rejects_excess_work(app_context):
    session = app_context.session
    session.add_all(
        [
            ReportRender(
                period="2026-08",
                granularity="month",
                timezone="UTC",
                kind="render",
                snapshot_json={},
                traceparent="test",
                created_by="capacity-test",
            )
            for _ in range(100)
        ]
    )
    await session.commit()
    response = await app_context.client.post(
        f"{PREFIX}/report-renders",
        json={"template_id": str(uuid.uuid4()), "period": "2026-08"},
    )
    assert response.status_code == 429
