"""订阅响应的终态批次进入客户端待续，实际回执后才产出最终答复。"""

import json
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, cast

import httpx2
import pytest
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from openai import AsyncOpenAI

from lib.resilience import CircuitBreaker
from llmcore import ModelChoice
from llmcore.codex import StoredTokenProvider, build_codex_model
from llmcore.guard import GuardedModel
from llmcore.tools.shapes import ToolSpec, object_schema, string_schema
from llmcore.turn import TurnDeps, run_turn


@dataclass(frozen=True)
class _Token:
    access_token: str = "mock-access-token"
    account_id: str | None = "mock-account"


class _Tokens:
    async def usable(self, provider: str) -> _Token:
        assert provider == "mock-provider"
        return _Token()


def _calls(count: int) -> list[dict[str, object]]:
    return [
        {
            "type": "function_call",
            "id": f"fc-{index}",
            "call_id": f"call-{index}",
            "name": "bind_field",
            "arguments": json.dumps(
                {"field": f"field-{index}", "point": f"point-{index}"}
            ),
            "status": "completed",
        }
        for index in range(count)
    ]


def _completed(output: Sequence[dict[str, object]]) -> dict[str, object]:
    return {
        "type": "response.completed",
        "response": {
            "id": "response-mock",
            "created_at": 0,
            "model": "mock-codex",
            "object": "response",
            "status": "completed",
            "output": list(output),
            "error": None,
            "incomplete_details": None,
            "parallel_tool_calls": True,
            "tool_choice": "auto",
            "tools": [],
            "usage": {
                "input_tokens": 20,
                "output_tokens": 8,
                "total_tokens": 28,
            },
        },
    }


def _answer() -> list[dict[str, object]]:
    return [
        _completed(
            [
                {
                    "type": "message",
                    "id": "message-mock",
                    "role": "assistant",
                    "status": "completed",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "字段绑定已补全并核对。",
                            "annotations": [],
                        }
                    ],
                }
            ]
        ),
    ]


def _sse(events: Sequence[dict[str, object]]) -> bytes:
    parts = [
        f"event: {event['type']}\ndata: "
        + json.dumps({**event, "sequence_number": index}, ensure_ascii=False)
        + "\n\n"
        for index, event in enumerate(events)
    ]
    return "".join(parts).encode()


def _model(client: AsyncOpenAI) -> ChatOpenAI:
    model = cast(
        "ChatOpenAI",
        build_codex_model(
            model="mock-codex",
            token_provider=StoredTokenProvider(
                _Tokens(), "mock-provider", seed=_Token()
            ),
            effort="high",
            timeout_s=1.0,
            originator="tests",
        ),
    )
    model.root_async_client = client
    return model


@asynccontextmanager
async def _conversation(
    count: int,
    is_empty_output: bool,
) -> AsyncIterator[tuple[GuardedModel, list[dict[str, object]]]]:
    requests: list[dict[str, object]] = []

    def handle(request: httpx2.Request) -> httpx2.Response:
        assert request.url.path == "/responses"
        requests.append(cast("dict[str, object]", json.loads(request.content)))
        events = (
            _first_events(count, is_empty_output)
            if len(requests) == 1
            else _answer()
        )
        return httpx2.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=_sse(events),
        )

    async with (
        httpx2.AsyncClient(
            transport=httpx2.MockTransport(handle), timeout=1.0
        ) as http,
        AsyncOpenAI(
            api_key="mock-access-token",
            base_url="https://codex.invalid",
            http_client=http,
            max_retries=0,
        ) as client,
    ):
        model = _model(client)

        async def source(choice: ModelChoice) -> BaseChatModel:
            assert choice.kind == "chat"
            return model

        yield (
            GuardedModel(
                source=source,
                is_streaming=True,
                breaker=CircuitBreaker(
                    name="mock", failure_threshold=1, reset_after_s=60
                ),
            ),
            requests,
        )


def _first_events(count: int, is_empty_output: bool) -> list[dict[str, object]]:
    calls = _calls(count)
    return [
        *[
            {
                "type": "response.output_item.done",
                "output_index": index,
                "item": item,
            }
            for index, item in enumerate(calls)
        ],
        _completed([] if is_empty_output else calls),
    ]


def _assert_receipts(request: dict[str, object], count: int) -> None:
    inputs = cast("list[dict[str, object]]", request["input"])
    assert [
        item for item in inputs if item["type"] == "function_call_output"
    ] == [
        {
            "type": "function_call_output",
            "call_id": f"call-{index}",
            "output": '{"ok":true}',
        }
        for index in range(count)
    ]


@pytest.mark.parametrize("count", [1, 12], ids=["one-field", "twelve-fields"])
@pytest.mark.parametrize(
    "is_empty_output", [True, False], ids=["empty-terminal", "full-terminal"]
)
async def test_terminal_binding_batch_waits_for_receipts_before_finishing(
    count: int,
    is_empty_output: bool,
) -> None:
    async def run_tool(name: str, arguments: dict[str, Any]) -> object:
        pytest.fail(f"客户端工具不应在服务端执行：{name} {arguments}")

    spec = ToolSpec(
        name="bind_field",
        description="绑定字段",
        parameters=object_schema(
            {"field": string_schema("字段"), "point": string_schema("点位")},
            ["field", "point"],
        ),
        runs_on="client",
    )
    messages = [
        SystemMessage(content="补全字段绑定，并根据实际回执核对。"),
        HumanMessage(content="补全所有字段的点位绑定。"),
    ]
    async with _conversation(count, is_empty_output) as (model, requests):
        deps = TurnDeps(model=model, specs=(spec,), run_tool=run_tool)
        first = await run_turn(deps, messages)
        assert first.is_waiting
        assert [
            (call.call_id, call.name, call.arguments) for call in first.pending
        ] == [
            (
                f"call-{index}",
                "bind_field",
                {"field": f"field-{index}", "point": f"point-{index}"},
            )
            for index in range(count)
        ]
        receipts = [
            ToolMessage(content='{"ok":true}', tool_call_id=call.call_id)
            for call in first.pending
        ]
        final = await run_turn(deps, [*messages, *first.messages, *receipts])
        assert not final.is_waiting
        assert final.reply == "字段绑定已补全并核对。"
        _assert_receipts(requests[1], count)
