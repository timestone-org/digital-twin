"""模型给的 id 进 URL 路径之前必须先认成 id。

守的是「只读工具不能被注入的文字拐去打写端点」：`dashboard_id="<id>:publish?"`
拼进路径后 `?` 把 `:validate` 挤成查询串，实际打到的是发布端点。
"""

import uuid
from typing import Any

import httpx
import pytest

from ai_assistant.apps.chat.services.tools.providers.knowledge import (
    KnowledgeTools,
)
from ai_assistant.apps.chat.services.tools.providers.server import (
    ServerTools,
    UnknownServerTool,
)
from ai_assistant.upstream import KnowledgeClient, PlatformClient
from llmcore.tools.ports import UnknownTool

ENVELOPE: dict[str, object] = {
    "code": 0,
    "message": "ok",
    "trace_id": "t",
    "data": {},
}


def _recorder() -> tuple[list[httpx.Request], httpx.MockTransport]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=ENVELOPE)

    return seen, httpx.MockTransport(handler)


def _server() -> tuple[list[httpx.Request], ServerTools]:
    seen, transport = _recorder()
    client = PlatformClient(base_url="http://platform.test", timeout_s=5)
    client.use_transport(transport)
    return seen, ServerTools(platform=client, headers={})


INJECTED: list[tuple[str, dict[str, Any]]] = [
    ("dashboard.validate", {"dashboard_id": f"{uuid.uuid4()}:publish?"}),
    (
        "formula.validate",
        {"table_id": "abc/../../dashboards/X:publish#", "formula": "1"},
    ),
    ("formula.preview", {"table_id": "..", "formula": "1"}),
    ("formula.catalog", {"table_id": "t1/../../x"}),
    ("datasets.read_columns", {"table_id": "t1?x"}),
    ("modules.catalog", {"module_type": "info-card/../../x"}),
    ("modules.catalog", {"module_type": "1abc"}),
]


@pytest.mark.parametrize(("name", "arguments"), INJECTED)
async def test_a_crafted_id_never_reaches_the_platform(
    name: str, arguments: dict[str, Any]
) -> None:
    seen, tools = _server()
    with pytest.raises(UnknownServerTool, match="不是合法"):
        await tools(name, arguments)
    assert seen == []


async def test_a_real_dashboard_id_still_hits_the_validate_endpoint() -> None:
    seen, tools = _server()
    target = uuid.uuid4()
    await tools("dashboard.validate", {"dashboard_id": f" {target} "})
    assert [request.method for request in seen] == ["POST"]
    assert seen[0].url.path == f"/api/v1/platform/dashboards/{target}:validate"


async def test_a_crafted_base_id_never_reaches_the_knowledge_server() -> None:
    seen, transport = _recorder()
    client = KnowledgeClient(base_url="http://knowledge.test", timeout_s=5)
    client.use_transport(transport)
    tools = KnowledgeTools(client=client, headers={})
    with pytest.raises(UnknownTool, match="不是合法"):
        await tools.run(
            "knowledge.search",
            {"base_id": f"{uuid.uuid4()}:sync?", "query": "甲"},
        )
    assert seen == []


async def test_the_platform_client_escapes_every_path_segment() -> None:
    """工具层之外还有别的调用方，客户端自己也不让一段 id 变成多段路径。"""
    seen, transport = _recorder()
    client = PlatformClient(base_url="http://platform.test", timeout_s=5)
    client.use_transport(transport)
    await client.validate_dashboard({}, "abc:publish?x")
    assert seen[0].url.raw_path == (
        b"/api/v1/platform/dashboards/abc%3Apublish%3Fx:validate"
    )


async def test_a_dot_dot_segment_stays_one_segment() -> None:
    seen, transport = _recorder()
    client = PlatformClient(base_url="http://platform.test", timeout_s=5)
    client.use_transport(transport)
    await client.list_dataset_columns({}, "..")
    assert (
        seen[0].url.raw_path
        == b"/api/v1/platform/dataset-tables/%2E%2E/columns"
    )
