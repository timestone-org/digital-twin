"""客户端回执必须逐个按调用 id 结算，缺回执不能推断执行。"""

import uuid

import pytest

from ai_assistant.apps.chat.models import ChatStep
from ai_assistant.apps.chat.services import client_receipts
from ai_assistant.apps.chat.services.advance_service import ClientToolResult
from lib.errors import ValidationFailed


def _pending(call_id: str = "a", name: str = "dashboard.save") -> ChatStep:
    return ChatStep(
        message_id=uuid.uuid4(),
        seq=1,
        kind="client_tool",
        name=name,
        state="awaiting_client",
        input_json={"call_id": call_id, "arguments": {}},
    )


def test_each_actual_receipt_settles_its_exact_call_and_preserves_missing() -> (
    None
):
    steps = [_pending("a"), _pending("b")]
    result = ClientToolResult(call_id="b", output={"is_saved": False})
    matched = client_receipts.match_results(steps, [result])
    client_receipts.settle(matched)
    assert steps[0].state == "awaiting_client"
    assert steps[1].state == "succeeded"
    assert steps[1].output_json == {"body": '{"is_saved": false}'}
    assert steps[1].ended_at is not None


def test_unknown_or_duplicate_call_rejects_before_mutation() -> None:
    step = _pending()
    with pytest.raises(ValidationFailed):
        client_receipts.match_results(
            [step], [ClientToolResult(call_id="other")]
        )
    with pytest.raises(ValidationFailed):
        client_receipts.match_results(
            [step], [ClientToolResult(call_id="a")] * 2
        )
    assert step.state == "awaiting_client"


def test_same_receipt_is_idempotent_but_conflicting_receipt_is_rejected() -> (
    None
):
    step = _pending()
    result = ClientToolResult(call_id="a", output="saved")
    client_receipts.settle(client_receipts.match_results([step], [result]))
    assert client_receipts.match_results([step], [result]) == []
    with pytest.raises(ValidationFailed):
        client_receipts.match_results(
            [step], [ClientToolResult(call_id="a", error="failed")]
        )


def test_error_ask_cancel_and_image_are_truthful_without_image_storage() -> (
    None
):
    steps = [_pending("a"), _pending("b", "user.ask"), _pending("c")]
    results = [
        ClientToolResult(call_id="a", error="保存失败"),
        ClientToolResult(call_id="b", output={"is_cancelled": True}),
        ClientToolResult(call_id="c", output="data:image/png;base64,large"),
    ]
    client_receipts.settle(client_receipts.match_results(steps, results))
    assert [step.state for step in steps] == ["failed", "aborted", "succeeded"]
    assert steps[0].error == "保存失败"
    assert steps[2].output_json == {"body": "[图片]"}


def test_legacy_batch_expands_all_calls_without_losing_arguments() -> None:
    step = _pending()
    step.input_json = {
        "calls": [
            {"call_id": "a", "name": "dashboard.save", "arguments": {}},
            {
                "call_id": "b",
                "name": "dashboard.capture",
                "arguments": {"scale": 2},
            },
        ]
    }
    added = client_receipts.expand_legacy([step])
    assert len(added) == 1
    assert added[0].message_id == step.message_id
    assert added[0].seq == 2
    assert added[0].name == "dashboard.capture"
    assert added[0].input_json == {"call_id": "b", "arguments": {"scale": 2}}
    assert step.input_json == {"call_id": "a", "arguments": {}}


def test_ambiguous_historical_ids_reject_without_settling_either() -> None:
    old, pending = _pending("salvaged-1"), _pending("salvaged-1")
    old.state = "succeeded"
    old.output_json = {"body": "previous real result"}
    result = ClientToolResult(call_id="salvaged-1", output="new real result")
    with pytest.raises(ValidationFailed, match="不唯一"):
        client_receipts.match_results([old, pending], [result])
    assert old.output_json == {"body": "previous real result"}
    assert old.state == "succeeded"
    assert pending.state == "awaiting_client"
