"""新运行冻结实际生效参数，流水线保存的用户配置保持原样。"""

import httpx
import pytest

from integration.modeling_helpers import (
    HTTP_ACCEPTED,
    PIPELINES,
    create_pipeline,
    data_of,
    edge,
    node,
)

pytestmark = pytest.mark.requires_postgres


@pytest.mark.parametrize(
    ("config", "action"),
    [({}, "coerce"), ({"to": "string", "on_error": "error"}, "error")],
)
async def test_new_run_freezes_defaults_without_editing_the_pipeline(
    app_client: httpx.AsyncClient, config: dict[str, object], action: str
) -> None:
    graph = {
        "format_version": "1.0",
        "nodes": [
            node("source", "ledger_source", table_code="energy"),
            node("cast", "cast_type", **config),
        ],
        "edges": [edge("source-cast", "source", "frame", "cast", "frame")],
    }
    pipeline = await create_pipeline(app_client, "snapshot-defaults", graph)
    response = await app_client.post(
        f"{PIPELINES}/{pipeline['id']}:run", json={"trigger": "manual"}
    )
    assert response.status_code == HTTP_ACCEPTED, response.text
    nodes = {item["id"]: item for item in data_of(response)["graph"]["nodes"]}
    assert nodes["cast"]["config"]["on_error"] == action
    assert nodes["cast"]["config"]["columns"] == []
    assert nodes["source"]["config"]["row_limit"] == 50000
    assert type(nodes["source"]["config"]["row_limit"]) is int
    assert nodes["source"]["config"]["row_source"] == "collect"
    stored = data_of(await app_client.get(f"{PIPELINES}/{pipeline['id']}"))
    saved = {item["id"]: item for item in stored["graph"]["nodes"]}
    assert saved["cast"]["config"] == config


async def test_nonfinite_parameters_are_rejected_before_snapshot_storage(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        PIPELINES,
        json={
            "code": "nonfinite-configuration",
            "name": "无效参数",
            "graph": {
                "format_version": "1.0",
                "nodes": [
                    node("source", "ledger_source", table_code="energy"),
                    node("fill", "fill_missing", value="Infinity"),
                ],
                "edges": [
                    edge("source-fill", "source", "frame", "fill", "frame")
                ],
            },
        },
    )
    assert response.status_code == 201
    pipeline = data_of(response)
    started = await app_client.post(
        f"{PIPELINES}/{pipeline['id']}:run", json={"trigger": "manual"}
    )
    assert started.status_code == 400
    assert "有限数值" in started.text
