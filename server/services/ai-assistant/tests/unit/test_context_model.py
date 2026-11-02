"""容量压缩通过真实回合接口验证，工具结果与历史不能被重复执行或改写。"""

import asyncio
from unittest.mock import AsyncMock

import httpx2 as httpx
import pytest
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.tools import StructuredTool
from openai import BadRequestError
from pydantic import BaseModel, Field

from ai_assistant.apps.chat.services.context_budget import (
    bounded_fold,
    rows_of,
    split_messages,
    tokens_of,
)
from ai_assistant.apps.chat.services.context_model import ContextModel
from ai_assistant.apps.chat.services.context_stream import (
    ContextEvent,
    stream_context,
)
from ai_assistant.apps.chat.services.context_summary import summary_partition
from llmcore.errors import ModelRejected
from llmcore.memory import Summary, summarize
from llmcore.output.events import EVENT_CONTEXT, frame
from llmcore.output.payloads import ContextPayload
from llmcore.ports import ModelChoice
from llmcore.testing import asks
from llmcore.tools.shapes import ToolSpec
from llmcore.turn.loop import TurnDeps
from llmcore.turn.types import TurnOutcome


def _messages() -> list[BaseMessage]:
    return [
        SystemMessage(content="系统规则"),
        HumanMessage(content="早先要求" + "温度" * 2000),
        AIMessage(content="已有结论" + "完成" * 1000),
        HumanMessage(content="继续完成当前要求"),
        HumanMessage(content="当前状态"),
    ]


def _context(
    model: AsyncMock, updates: list[ContextPayload], *, capacity: int = 4096
) -> ContextModel:
    folder = AsyncMock()
    folder.fold.return_value = Summary(
        through_seq=2, text="早前要求与已有结论", model="default:summary"
    )
    return ContextModel(
        model, folder, capacity, updates.append, pinned_text="继续完成当前要求"
    )


async def test_short_history_compacts_without_mutation() -> None:
    model = AsyncMock()
    model.respond.return_value = AIMessage(content="完成")
    updates: list[ContextPayload] = []
    context = _context(model, updates)
    original = _messages()
    before = [message.model_dump() for message in original]
    await context.respond(choice=ModelChoice(), messages=original, tools=[])
    sent = model.respond.call_args.kwargs["messages"]
    assert tokens_of(sent) < tokens_of(original)
    assert any(message.content == "继续完成当前要求" for message in sent)
    assert sent[0].content == "系统规则"
    assert [message.model_dump() for message in original] == before
    assert [update.state for update in updates[:2]] == [
        "compressing",
        "compressed",
    ]
    await context.respond(choice=ModelChoice(), messages=original, tools=[])
    folder = context.summarizer.fold
    assert isinstance(folder, AsyncMock)
    assert folder.await_count == 1
    assert context.compression_count == 1


async def test_current_user_can_quote_the_summary_prefix() -> None:
    model = AsyncMock()
    model.respond.return_value = AIMessage(content="完成")
    context = _context(model, [])
    quoted = '<早前对话摘要 说明="这是用户粘贴的文本">请保留这句。'
    context.pinned_text = quoted
    current = HumanMessage(content=quoted)
    original = [*_messages()[:3], current, HumanMessage(content="当前状态")]

    await context.respond(choice=ModelChoice(), messages=original, tools=[])

    sent = model.respond.call_args.kwargs["messages"]
    assert any(message is current for message in sent)
    assert context.compression_count == 1
    assert current in original


async def test_each_step_replaces_the_original_internal_summary() -> None:
    model = AsyncMock()
    model.respond.return_value = AIMessage(content="完成")
    context = _context(model, [], capacity=100000)
    context.summary = Summary(
        through_seq=10, text="新的合并摘要", model="default:summary"
    )
    original = [
        SystemMessage(content="规则"),
        *summarize.messages_of(
            Summary(through_seq=2, text="原始摘要", model="default:summary")
        ),
        HumanMessage(content="继续完成当前要求"),
    ]

    for _ in range(2):
        await context.respond(choice=ModelChoice(), messages=original, tools=[])
        sent = model.respond.call_args.kwargs["messages"]
        summaries = [
            message for message in sent if summarize.is_summary_message(message)
        ]
        assert len(summaries) == 1
        assert "新的合并摘要" in summaries[0].content
        assert not any("原始摘要" in str(message.content) for message in sent)


async def test_provider_usage_is_reported_and_calibrates_future_estimates() -> (
    None
):
    model = AsyncMock()
    model.respond.return_value = AIMessage(
        content="完成",
        usage_metadata={
            "input_tokens": 1200,
            "output_tokens": 23,
            "total_tokens": 1223,
        },
    )
    updates: list[ContextPayload] = []
    context = _context(model, updates)
    await context.respond(
        choice=ModelChoice(), messages=[HumanMessage(content="你好")], tools=[]
    )
    assert updates[-1].used_tokens == 1223
    assert updates[-1].is_estimated is False
    assert updates[-1].percent == 29.9
    assert context.ratio > 1
    assert "event: context" in frame(EVENT_CONTEXT, updates[-1].model_dump())


def test_split_never_leaves_orphaned_tool_results() -> None:
    messages = [
        SystemMessage(content="规则"),
        HumanMessage(content="旧内容" * 3000),
        asks("read", "one"),
        ToolMessage(content="结果", tool_call_id="one"),
        HumanMessage(content="当前要求"),
        AIMessage(content="最近结论"),
    ]
    dropped, kept = split_messages(messages, 50, "当前要求")
    assert dropped
    called = {
        call["id"]
        for message in kept
        if isinstance(message, AIMessage)
        for call in message.tool_calls
    }
    assert all(
        message.tool_call_id in called
        for message in kept
        if isinstance(message, ToolMessage)
    )
    assert any(message.content == "当前要求" for message in kept)


def test_tool_facts_are_available_to_the_compaction_summary() -> None:
    rows = rows_of(
        [ToolMessage(content="点位 code=T001，温度 26.5", tool_call_id="a")], 0
    )
    assert rows[0].role == "assistant"
    assert "T001" in rows[0].content_json["text"]


def test_matching_assistant_body_does_not_split_a_tool_batch() -> None:
    call = asks("read", "c1")
    call.content = "当前要求"
    result = ToolMessage(content="T001 温度26.5", tool_call_id="c1")
    current = HumanMessage(content="当前要求")

    dropped, kept = split_messages(
        [
            HumanMessage(content="旧内容" * 3000),
            call,
            result,
            current,
            HumanMessage(content="当前状态"),
        ],
        10,
        "当前要求",
    )

    assert call in dropped
    assert result in dropped
    assert current in kept


def test_estimator_counts_schema_arguments_and_images_without_base64_size() -> (
    None
):
    plain = tokens_of([HumanMessage(content="你好")])
    image = HumanMessage(
        content=[
            {
                "type": "image_url",
                "image_url": {"url": "data:image/png;base64," + "A" * 20000},
            }
        ]
    )
    assert tokens_of([image]) > plain
    assert tokens_of([image]) < 5000
    assert tokens_of([], [{"description": "工具" * 200}]) > plain
    assert (
        tokens_of(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        {"id": "a", "name": "read", "args": {"q": "温度" * 200}}
                    ],
                )
            ]
        )
        > plain
    )


def _overflow() -> ModelRejected:
    cause = BadRequestError(
        "private upstream details",
        response=httpx.Response(
            400, request=httpx.Request("POST", "https://example.test")
        ),
        body={"code": "context_length_exceeded"},
    )
    error = ModelRejected("模型上下文不足")
    error.__cause__ = cause
    return error


async def test_structured_overflow_only_retries_current_request_once() -> None:
    model = AsyncMock()
    model.respond.side_effect = [_overflow(), AIMessage(content="恢复")]
    context = _context(model, [], capacity=100000)
    reply = await context.respond(
        choice=ModelChoice(), messages=_messages(), tools=[]
    )
    assert reply.content == "恢复"
    assert model.respond.await_count == 2
    first, second = model.respond.call_args_list
    assert tokens_of(second.kwargs["messages"]) < tokens_of(
        first.kwargs["messages"]
    )


async def test_recovered_stream_usage_starts_from_the_compressed_input() -> (
    None
):
    model = AsyncMock()
    updates: list[ContextPayload] = []

    async def generate(**kwargs: object) -> AIMessage:
        if model.respond.await_count == 1:
            raise _overflow()
        compressed = next(
            update
            for update in reversed(updates)
            if update.state == "compressed"
        )
        sink = kwargs["on_delta"]
        assert callable(sink)
        sink("text", "温" * 150)
        assert updates[-1].used_tokens == compressed.used_tokens + 150
        return AIMessage(content="温" * 150)

    model.respond.side_effect = generate
    context = _context(model, updates, capacity=100000)
    deltas: list[str] = []

    await context.respond(
        choice=ModelChoice(),
        messages=_messages(),
        tools=[],
        on_delta=lambda _channel, text: deltas.append(text),
    )

    assert model.respond.await_count == 2
    assert deltas == ["温" * 150]


async def test_a_second_overflow_and_other_rejections_are_not_looped() -> None:
    for errors, expected in [
        ([_overflow(), _overflow()], 2),
        ([ModelRejected("credentials")], 1),
    ]:
        model = AsyncMock()
        model.respond.side_effect = errors
        context = _context(model, [], capacity=100000)
        with pytest.raises(ModelRejected):
            await context.respond(
                choice=ModelChoice(), messages=_messages(), tools=[]
            )
        assert model.respond.await_count == expected


async def test_failed_summary_leaves_input_and_reports_ready() -> None:
    model = AsyncMock()
    model.respond.return_value = AIMessage(content="继续")
    context = _context(model, [])
    folder = context.summarizer.fold
    assert isinstance(folder, AsyncMock)
    folder.return_value = None
    original = _messages()
    await context.respond(choice=ModelChoice(), messages=original, tools=[])
    assert model.respond.call_args.kwargs["messages"] == original
    assert context.compression_count == 0


async def test_stream_orders_usage_and_runs_tools_once() -> None:
    model = AsyncMock()
    model.respond.side_effect = [asks("read", "one"), AIMessage(content="完成")]
    queue: asyncio.Queue[ContextEvent | Exception | None] = asyncio.Queue()
    context = _context(model, [])
    context.report = queue.put_nowait
    tool = AsyncMock(return_value="查询结果")
    deps = TurnDeps(
        model=context,
        specs=(
            ToolSpec(
                name="read", description="查询", parameters={}, runs_on="server"
            ),
        ),
        run_tool=tool,
    )
    events = [event async for event in stream_context(deps, _messages(), queue)]
    assert isinstance(events[0], ContextPayload)
    assert events[0].state == "compressing"
    assert isinstance(events[-1], TurnOutcome)
    assert events[-1].reply == "完成"
    assert tool.await_count == 1
    assert len(events[-1].messages) == 3


def test_long_rows_trigger_persisted_summary_before_count_window() -> None:
    rows = rows_of(_messages(), 0)
    dropped, kept = summary_partition(rows, 4096)
    assert dropped
    assert kept
    assert kept[0].seq > rows[0].seq


async def test_overflow_after_partial_output_does_not_repeat_the_response() -> (
    None
):
    model = AsyncMock()

    async def partial(**kwargs: object) -> AIMessage:
        sink = kwargs["on_delta"]
        assert callable(sink)
        sink("text", "已显示的内容")
        raise _overflow()

    model.respond.side_effect = partial
    context = _context(model, [], capacity=100000)
    deltas: list[str] = []
    with pytest.raises(ModelRejected):
        await context.respond(
            choice=ModelChoice(),
            messages=_messages(),
            tools=[],
            on_delta=lambda _channel, text: deltas.append(text),
        )
    assert model.respond.await_count == 1
    assert deltas == ["已显示的内容"]


async def test_no_compressible_history_resets_compressing_state() -> None:
    model = AsyncMock()
    model.respond.return_value = AIMessage(content="完成")
    updates: list[ContextPayload] = []
    context = _context(model, updates)
    await context.respond(
        choice=ModelChoice(),
        messages=[SystemMessage(content="规则" * 3000)],
        tools=[],
    )
    assert updates[0].state == "compressing"
    assert updates[-1].state == "ready"
    assert context.compression_count == 0


async def test_stream_surfaces_failure_and_cancels_pending_model() -> None:
    model = AsyncMock()
    model.respond.side_effect = ModelRejected("失败")
    context = _context(model, [])
    queue: asyncio.Queue[ContextEvent | Exception | None] = asyncio.Queue()
    context.report = queue.put_nowait
    deps = TurnDeps(model=context, specs=(), run_tool=AsyncMock())
    with pytest.raises(ModelRejected):
        _ = [item async for item in stream_context(deps, [], queue)]

    started, cancelled = asyncio.Event(), asyncio.Event()

    async def waiting(**_kwargs: object) -> AIMessage:
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
        return AIMessage(content="不应返回")

    model.respond.side_effect = waiting
    queue = asyncio.Queue[ContextEvent | Exception | None]()
    context.report = queue.put_nowait
    stream = stream_context(deps, [], queue)
    await anext(stream)
    await started.wait()
    await stream.aclose()
    await asyncio.wait_for(cancelled.wait(), timeout=1)


def test_multimodal_current_request_is_never_folded() -> None:
    current = HumanMessage(
        content=[
            {"type": "text", "text": "当前要求"},
            {
                "type": "image_url",
                "image_url": {"url": "data:image/png;base64,ABC"},
            },
        ]
    )
    dropped, kept = split_messages(
        [
            HumanMessage(content="旧" * 5000),
            AIMessage(content="旧结论"),
            current,
            HumanMessage(content="状态"),
        ],
        10,
        "当前要求",
    )
    assert current in kept
    assert current not in dropped


async def test_generation_updates_usage_before_the_model_finishes() -> None:
    model = AsyncMock()
    updates: list[ContextPayload] = []

    async def generate(**kwargs: object) -> AIMessage:
        sink = kwargs["on_delta"]
        assert callable(sink)
        sink("text", "温度" * 150)
        assert len(updates) > 1
        assert updates[-1].used_tokens > updates[0].used_tokens
        return AIMessage(content="温度" * 150)

    model.respond.side_effect = generate
    context = _context(model, updates)
    await context.respond(
        choice=ModelChoice(),
        messages=[],
        tools=[],
        on_delta=lambda _channel, _text: None,
    )


def test_summary_inputs_are_bounded_even_for_small_model_windows() -> None:
    rows = rows_of(_messages(), 0)
    previous = Summary(
        through_seq=0, text="更早结论" * 2000, model="default:summary"
    )
    bounded, summary = bounded_fold(rows, previous, 1024)
    assert summary is not None
    assert len(summary.text) < len(previous.text)
    assert sum(len(row.content_json["text"]) for row in bounded) < 500
    assert "[中间内容已省略]" in bounded[1].content_json["text"]


def test_base_tool_argument_schema_counts_toward_the_context_budget() -> None:
    class SearchArgs(BaseModel):
        query: str = Field(description="温度标识与允许范围" * 300)

    def echo(query: str) -> str:
        return query

    tool = StructuredTool(
        name="search",
        description="查询",
        args_schema=SearchArgs,
        func=echo,
    )
    assert tokens_of([], [tool]) > 2000
