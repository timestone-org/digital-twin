"""台账布尔值从真实试算到 Word 生成保持相同文本。"""

import io
import uuid

import httpx
import pytest
from conftest import AppContext
from docx import Document
from unit.source_fakes import InMemoryStream

from integration.dataset_helpers import (
    create_column,
    create_record,
    create_table,
    data_of,
)
from platform_server.apps.report.services.worker import (
    ReportWorker,
    WordPool,
    WorkerOptions,
)

pytestmark = pytest.mark.requires_postgres
PREFIX = "/api/v1/platform"


async def template_for_states(client: httpx.AsyncClient) -> str:
    table = await create_table(
        client, code="state_" + uuid.uuid4().hex, name="设备状态"
    )
    await create_column(
        client, table["id"], key="flag", name="运行", data_type="bool"
    )
    await create_column(
        client, table["id"], key="note", name="原文", data_type="string"
    )
    for hour, flag in enumerate((True, False, None), start=1):
        await create_record(
            client,
            table["id"],
            ts=f"2026-11-02T0{hour}:00:00Z",
            values={"flag": flag, "note": "True"},
        )
    created = await client.post(
        f"{PREFIX}/report-templates",
        json={
            "code": "report_" + uuid.uuid4().hex,
            "name": "运行状态报告",
            "doc_json": {
                "type": "doc",
                "content": [
                    {
                        "type": "dsTable",
                        "attrs": {
                            "table": table["code"],
                            "keys": ["flag", "note"],
                            "order": "asc",
                        },
                    }
                ],
            },
        },
    )
    assert created.status_code == 201
    return str(data_of(created)["id"])


async def test_preview_and_generated_word_distinguish_boolean_from_text(
    app_context: AppContext,
    stream: InMemoryStream,
) -> None:
    client = app_context.client
    template = await template_for_states(client)
    trial = await client.post(
        f"{PREFIX}/report-templates/{template}:preview",
        json={"period": "2026-11"},
    )
    assert trial.status_code == 200
    node = next(iter(data_of(trial)["nodes"].values()))
    expected = [["true", "True"], ["false", "True"], ["—", "True"]]
    assert [row[1:] for row in node["rows"]] == expected

    submitted = await client.post(
        f"{PREFIX}/report-renders",
        json={"template_id": template, "period": "2026-11"},
    )
    assert submitted.status_code == 202
    render_id = uuid.UUID(data_of(submitted)["id"])
    pool = WordPool()
    worker = ReportWorker(
        WorkerOptions(
            database=app_context.sessions,
            stream=stream,
            store=app_context.object_store,
            consumer="bool-report",
        ),
        pool,
    )
    try:
        await worker.execute(render_id)
    finally:
        pool.close()
    downloaded = await client.get(f"{PREFIX}/report-renders/{render_id}/files")
    assert downloaded.status_code == 200
    rows = Document(io.BytesIO(downloaded.content)).tables[0].rows
    assert [
        [cell.text for cell in row.cells[1:]] for row in rows[1:]
    ] == expected
