"""订阅模型流式工具调用在完整回执处保留参数、身份与执行次数。"""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, cast

import httpx2
import pytest
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from openai import AsyncOpenAI

from lib.resilience import CircuitBreaker
from llmcore import DeltaChannel, ModelChoice, ModelUnavailable
from llmcore.codex import StoredTokenProvider, build_codex_model
from llmcore.deltas import reasoning_of, text_of
from llmcore.guard import GuardedModel, usage_of


@dataclass(frozen=True)
class _Token:
    access_token: str = "mock-access-token"
    account_id: str | None = "mock-account"


class _TokenSource:
    async def usable(self, provider: str) -> _Token:
        assert provider == "mock-provider"
        return _Token()


def _items(count: int) -> list[dict[str, object]]:
    """构造具有独立身份和参数的工具回执。Args: count。"""
    return [
        {
            "type": "function_call",
            "id": f"fc-{index}",
            "call_id": f"call-{index}",
            "name": "inspect_item",
            "arguments": json.dumps(
                {"key": f"item-{index}", "mode": "详细", "enabled": False},
                ensure_ascii=False,
            ),
            "status": "completed",
        }
        for index in range(count)
    ]


def _event(kind: str, **payload: object) -> dict[str, object]:
    return {"type": kind, **payload}


def _added(index: int, item: dict[str, object]) -> dict[str, object]:
    return _event(
        "response.output_item.added",
        output_index=index,
        item={**item, "arguments": "", "status": "in_progress"},
    )


def _done(index: int, item: dict[str, object]) -> list[dict[str, object]]:
    """构造参数和工具项各自的完成事件。Args: index, item。"""
    return [
        _event(
            "response.function_call_arguments.done",
            output_index=index,
            item_id=item["id"],
            arguments=item["arguments"],
        ),
        _event("response.output_item.done", output_index=index, item=item),
    ]


def _response(
    items: Sequence[dict[str, object]], status: str
) -> dict[str, object]:
    """构造终态响应及用量。Args: items, status。"""
    return {
        "id": "response-mock",
        "created_at": 0,
        "model": "mock-codex",
        "object": "response",
        "status": status,
        "output": list(items),
        "error": None,
        "incomplete_details": (
            {"reason": "max_output_tokens"} if status == "incomplete" else None
        ),
        "parallel_tool_calls": True,
        "tool_choice": "auto",
        "tools": [],
        "usage": {
            "input_tokens": 20,
            "input_tokens_details": {"cached_tokens": 10},
            "output_tokens": 8,
            "output_tokens_details": {"reasoning_tokens": 2},
            "total_tokens": 28,
        },
    }


def _sse(events: Sequence[dict[str, object]]) -> bytes:
    """把事件编码为 SDK 实际读取的 SSE。Args: events。"""
    parts: list[str] = []
    for index, event in enumerate(events):
        payload = json.dumps(
            {**event, "sequence_number": index}, ensure_ascii=False
        )
        parts.append(f"event: {event['type']}\ndata: {payload}\n\n")
    return "".join(parts).encode()


def _model(
    api_client: AsyncOpenAI,
    output_version: Literal["v0", "responses/v1"] | None,
) -> ChatOpenAI:
    """构造真实订阅模型并注入 HTTP 假件。Args: api_client, output_version。"""
    # ⚠ 生产构造器返回的模型属于 ChatOpenAI，HTTP 客户端是公开注入字段。
    model = cast(
        "ChatOpenAI",
        build_codex_model(
            model="mock-codex",
            token_provider=StoredTokenProvider(
                _TokenSource(), "mock-provider", seed=_Token()
            ),
            effort="medium",
            timeout_s=1.0,
            originator="tests",
        ),
    )
    model.root_async_client = api_client
    model.output_version = output_version
    return model


def _guarded(model: BaseChatModel, is_streaming: bool) -> GuardedModel:
    """装配真实模型调用外壳。Args: model, is_streaming。"""

    async def source(choice: ModelChoice) -> BaseChatModel:
        assert choice.kind == "chat"
        return model

    return GuardedModel(
        source=source,
        is_streaming=is_streaming,
        breaker=CircuitBreaker(
            name="mock", failure_threshold=1, reset_after_s=60
        ),
    )


async def _respond(
    events: Sequence[dict[str, object]],
    *,
    is_streaming: bool = True,
    seen: list[tuple[DeltaChannel, str]] | None = None,
    output_version: Literal["v0", "responses/v1"] | None = None,
) -> AIMessage:
    """读 SSE。Args: events, is_streaming, seen, output_version。"""

    def handle(request: httpx2.Request) -> httpx2.Response:
        assert request.url.path == "/responses"
        return httpx2.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=_sse(events),
        )

    async with (
        httpx2.AsyncClient(
            transport=httpx2.MockTransport(handle), timeout=1.0
        ) as http_client,
        AsyncOpenAI(
            api_key="mock-access-token",
            base_url="https://codex.invalid",
            http_client=http_client,
            max_retries=0,
        ) as api_client,
    ):

        def on_delta(channel: DeltaChannel, text: str) -> None:
            if seen is not None:
                seen.append((channel, text))

        guarded = _guarded(_model(api_client, output_version), is_streaming)
        return await guarded.respond(
            choice=ModelChoice(),
            messages=[
                SystemMessage(content="调用工具读取所有目标。"),
                HumanMessage(content="读取目标。"),
            ],
            tools=(),
            on_delta=on_delta,
        )


def _assert_calls(reply: AIMessage, count: int) -> None:
    """核验每次调用的完整参数与唯一身份。Args: reply, count。"""
    assert reply.tool_calls == [
        {
            "type": "tool_call",
            "name": "inspect_item",
            "id": f"call-{index}",
            "args": {
                "key": f"item-{index}",
                "mode": "详细",
                "enabled": False,
            },
        }
        for index in range(count)
    ]
    assert reply.invalid_tool_calls == []


@pytest.mark.parametrize("count", [1, 3, 12], ids=["one", "three", "twelve"])
@pytest.mark.parametrize(
    "is_streaming", [True, False], ids=["astream", "ainvoke"]
)
async def test_done_only_calls_preserve_all_arguments(
    count: int, is_streaming: bool
) -> None:
    items = _items(count)
    events: list[dict[str, object]] = []
    for index, item in enumerate(items):
        events.append(_added(index, item))
        events.extend(_done(index, item))
    events.append(
        _event("response.completed", response=_response(items, "completed"))
    )

    reply = await _respond(events, is_streaming=is_streaming)

    _assert_calls(reply, count)


async def test_interleaved_parallel_deltas_keep_their_call_identity() -> None:
    items = _items(3)
    events = [_added(index, item) for index, item in enumerate(items)]
    for part in range(2):
        for index, item in enumerate(items):
            arguments = str(item["arguments"])
            midpoint = len(arguments) // 2
            events.append(
                _event(
                    "response.function_call_arguments.delta",
                    output_index=index,
                    item_id=item["id"],
                    delta=(
                        arguments[:midpoint]
                        if part == 0
                        else arguments[midpoint:]
                    ),
                )
            )
    for index, item in enumerate(items):
        events.extend(_done(index, item))
    events.append(
        _event("response.completed", response=_response(items, "completed"))
    )

    reply = await _respond(events)

    _assert_calls(reply, 3)


@pytest.mark.parametrize(
    "is_streaming", [True, False], ids=["astream", "ainvoke"]
)
async def test_incomplete_responses_cannot_execute_tools(
    is_streaming: bool,
) -> None:
    items = _items(3)
    events = [_added(index, item) for index, item in enumerate(items)]
    events.append(
        _event("response.incomplete", response=_response(items, "incomplete"))
    )

    with pytest.raises(ModelUnavailable):
        await _respond(events, is_streaming=is_streaming)


@pytest.mark.parametrize(
    "is_streaming", [True, False], ids=["astream", "ainvoke"]
)
async def test_a_stream_without_completed_cannot_execute_tools(
    is_streaming: bool,
) -> None:
    items = _items(3)
    events: list[dict[str, object]] = []
    for index, item in enumerate(items):
        events.append(_added(index, item))
        events.extend(_done(index, item))

    with pytest.raises(ModelUnavailable):
        await _respond(events, is_streaming=is_streaming)


@pytest.mark.parametrize("arguments", ['{"key":', "[]", '"item-0"', "null"])
@pytest.mark.parametrize(
    "is_streaming", [True, False], ids=["astream", "ainvoke"]
)
async def test_final_arguments_must_be_complete_json_objects(
    arguments: str, is_streaming: bool
) -> None:
    items = [{**_items(1)[0], "arguments": arguments}]
    events = [
        _added(0, items[0]),
        _event("response.completed", response=_response(items, "completed")),
    ]

    with pytest.raises(ModelUnavailable):
        await _respond(events, is_streaming=is_streaming)


@pytest.mark.parametrize(
    "is_streaming", [True, False], ids=["astream", "ainvoke"]
)
async def test_duplicate_call_ids_cannot_execute_tools(
    is_streaming: bool,
) -> None:
    items = _items(3)
    items[1] = {**items[1], "call_id": "call-0"}
    events = [
        _event("response.completed", response=_response(items, "completed"))
    ]

    with pytest.raises(ModelUnavailable):
        await _respond(events, is_streaming=is_streaming)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", ""),
        ("call_id", ""),
        ("status", "incomplete"),
        ("status", "in_progress"),
        ("status", None),
    ],
    ids=["no-name", "no-call-id", "incomplete", "in-progress", "no-status"],
)
@pytest.mark.parametrize(
    "is_streaming", [True, False], ids=["astream", "ainvoke"]
)
async def test_terminal_tools_require_identity_and_completed_items(
    field: str, value: object, is_streaming: bool
) -> None:
    items = [{**_items(1)[0], field: value}]
    events = [
        _event("response.completed", response=_response(items, "completed"))
    ]

    with pytest.raises(ModelUnavailable):
        await _respond(events, is_streaming=is_streaming)


@pytest.mark.parametrize(
    "is_streaming", [True, False], ids=["astream", "ainvoke"]
)
async def test_completed_output_alone_preserves_the_full_tool_batch(
    is_streaming: bool,
) -> None:
    events = [
        _event("response.completed", response=_response(_items(3), "completed"))
    ]

    reply = await _respond(events, is_streaming=is_streaming)

    _assert_calls(reply, 3)


@pytest.mark.parametrize(
    "is_streaming", [True, False], ids=["astream", "ainvoke"]
)
async def test_repeated_completed_events_emit_each_tool_call_once(
    is_streaming: bool,
) -> None:
    items = _items(3)
    completed = _event(
        "response.completed", response=_response(items, "completed")
    )
    events = [
        _event("response.in_progress", response=_response([], "in_progress")),
        completed,
        completed,
    ]

    reply = await _respond(events, is_streaming=is_streaming)

    _assert_calls(reply, 3)
    assert usage_of(reply) == {"prompt": 20, "cached": 10, "output": 8}


def _non_tool_events() -> (
    tuple[list[dict[str, object]], list[dict[str, object]]]
):
    """构造思考摘要与正文事件及终态输出。"""
    reasoning: dict[str, object] = {
        "type": "reasoning",
        "id": "reasoning-mock",
        "summary": [{"type": "summary_text", "text": "先核验身份。"}],
        "encrypted_content": "sealed-reasoning",
    }
    message: dict[str, object] = {
        "type": "message",
        "id": "message-mock",
        "role": "assistant",
        "status": "completed",
        "content": [
            {"type": "output_text", "text": "读取完成。", "annotations": []}
        ],
    }
    return [
        _event(
            "response.output_item.added",
            output_index=0,
            item={**reasoning, "summary": [], "encrypted_content": None},
        ),
        _event(
            "response.reasoning_summary_text.delta",
            output_index=0,
            item_id=reasoning["id"],
            summary_index=0,
            delta="先核验身份。",
        ),
        _event("response.output_item.done", output_index=0, item=reasoning),
        _event(
            "response.output_text.delta",
            output_index=1,
            item_id=message["id"],
            content_index=0,
            delta="读取完成。",
        ),
        _event(
            "response.output_text.done",
            output_index=1,
            item_id=message["id"],
            content_index=0,
            text="读取完成。",
        ),
    ], [reasoning, message]


@pytest.mark.parametrize(
    "is_streaming", [True, False], ids=["astream", "ainvoke"]
)
async def test_text_reasoning_and_usage_survive_tool_collection(
    is_streaming: bool,
) -> None:
    events, outputs = _non_tool_events()
    item = _items(1)[0]
    events.append(_added(2, item))
    events.extend(_done(2, item))
    events.append(
        _event(
            "response.completed",
            response=_response([*outputs, item], "completed"),
        )
    )
    seen: list[tuple[DeltaChannel, str]] = []

    reply = await _respond(events, is_streaming=is_streaming, seen=seen)

    _assert_calls(reply, 1)
    assert text_of(reply) == "读取完成。"
    assert reasoning_of(reply) == "先核验身份。"
    assert usage_of(reply) == {"prompt": 20, "cached": 10, "output": 8}
    assert any(
        isinstance(block, dict)
        and block.get("encrypted_content") == "sealed-reasoning"
        for block in reply.content
    )
    assert seen == (
        [("reasoning", "先核验身份。"), ("text", "读取完成。")]
        if is_streaming
        else []
    )


@pytest.mark.parametrize(
    "is_streaming", [True, False], ids=["astream", "ainvoke"]
)
async def test_v0_preserves_text_reasoning_and_complete_tool_arguments(
    is_streaming: bool,
) -> None:
    events, outputs = _non_tool_events()
    item = _items(1)[0]
    events.append(_added(2, item))
    events.extend(_done(2, item))
    events.append(
        _event(
            "response.completed",
            response=_response([*outputs, item], "completed"),
        )
    )

    reply = await _respond(
        events, is_streaming=is_streaming, output_version="v0"
    )

    _assert_calls(reply, 1)
    assert text_of(reply) == "读取完成。"
    assert reply.additional_kwargs["reasoning"] == {
        "type": "reasoning",
        "id": "reasoning-mock",
        "summary": [
            {"index": 0, "type": "summary_text", "text": "先核验身份。"}
        ],
        "encrypted_content": "sealed-reasoning",
    }
    assert usage_of(reply) == {"prompt": 20, "cached": 10, "output": 8}


@pytest.mark.parametrize(
    "is_streaming", [True, False], ids=["astream", "ainvoke"]
)
async def test_incomplete_pure_text_still_preserves_the_partial_answer(
    is_streaming: bool,
) -> None:
    events, outputs = _non_tool_events()
    events.append(
        _event("response.incomplete", response=_response(outputs, "incomplete"))
    )

    reply = await _respond(events, is_streaming=is_streaming)

    assert text_of(reply) == "读取完成。"
    assert reply.tool_calls == []
    assert reply.response_metadata["status"] == "incomplete"


async def test_deltas_and_done_receipts_emit_each_call_once() -> None:
    items = _items(3)
    events: list[dict[str, object]] = []
    for index, item in enumerate(items):
        events.append(_added(index, item))
        events.append(
            _event(
                "response.function_call_arguments.delta",
                output_index=index,
                item_id=item["id"],
                delta=item["arguments"],
            )
        )
        events.extend(_done(index, item))
    events.append(
        _event("response.completed", response=_response(items, "completed"))
    )

    reply = await _respond(events)

    _assert_calls(reply, 3)
