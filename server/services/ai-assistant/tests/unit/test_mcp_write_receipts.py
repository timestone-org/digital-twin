"""MCP 的实际写回执只能由服务端产生。"""

import uuid

import pytest

from ai_assistant.apps.chat.models import ChatStep
from ai_assistant.apps.chat.services import client_receipts
from ai_assistant.apps.chat.services.client_result import ClientToolResult
from lib.errors import ValidationFailed


@pytest.mark.parametrize("state", ["awaiting_client", "running"])
def test_browser_cannot_forge_mcp_write_receipt(state: str) -> None:
    step = ChatStep(
        message_id=uuid.uuid4(),
        seq=1,
        kind="client_tool",
        name="mcp.test.save",
        state=state,
        input_json={"call_id": "write", "arguments": {}},
    )
    with pytest.raises(ValidationFailed):
        client_receipts.match_results(
            [step], [ClientToolResult(call_id="write", output={"saved": True})]
        )
    assert step.state == state


def test_server_receipt_can_be_acknowledged_without_executing_again() -> None:
    step = ChatStep(
        message_id=uuid.uuid4(),
        seq=1,
        kind="client_tool",
        name="mcp.test.save",
        state="running",
        input_json={"call_id": "write", "arguments": {}},
    )
    result = ClientToolResult(call_id="write", output={"saved": True})
    client_receipts.settle([(step, result)])
    assert client_receipts.match_results([step], [result]) == []
