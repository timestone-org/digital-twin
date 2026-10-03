"""外部 MCP 没有实际结果时不能记录为空对象成功。"""

import httpx
import pytest

from ai_assistant.upstream.mcp import McpClient, McpServer, McpUnavailable


@pytest.mark.parametrize(
    "envelope",
    [{}, {"result": None}, {"result": []}, {"result": "accepted"}],
)
async def test_invalid_rpc_result_is_unavailable(
    envelope: dict[str, object],
) -> None:
    client = McpClient(timeout_s=1)
    client.use_transport(
        httpx.MockTransport(lambda _: httpx.Response(200, json=envelope))
    )
    try:
        with pytest.raises(McpUnavailable):
            await client.call_tool(
                McpServer(name="test", url="http://test.invalid/mcp"),
                None,
                "write",
                {},
            )
    finally:
        await client.close()


async def test_valid_rpc_result_preserves_actual_failure_fields() -> None:
    result = {"isError": True, "content": [{"type": "text", "text": "no"}]}
    client = McpClient(timeout_s=1)
    client.use_transport(
        httpx.MockTransport(
            lambda _: httpx.Response(200, json={"result": result})
        )
    )
    try:
        received = await client.call_tool(
            McpServer(name="test", url="http://test.invalid/mcp"),
            None,
            "write",
            {},
        )
        assert received == result
    finally:
        await client.close()
