"""订阅模型的 Responses 流：正文逐段显示，工具只取终态完整参数。"""

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, cast

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun
from langchain_core.messages import AIMessageChunk, BaseMessage
from langchain_core.messages.tool import ToolCallChunk, tool_call_chunk
from langchain_core.outputs import ChatGenerationChunk
from langchain_openai.chat_models import base, codex
from openai.types.responses import (
    Response,
    ResponseCompletedEvent,
    ResponseIncompleteEvent,
    ResponseOutputItemAddedEvent,
    ResponseOutputItemDoneEvent,
    ResponseStreamEvent,
)

from lib.logging import get_logger
from llmcore.codex.streaming_content import ContentTracker
from llmcore.codex.streaming_items import OutputItems
from llmcore.errors import ModelUnavailable

_logger = get_logger("llmcore.codex.streaming")


class CodexChatModel(
    codex._ChatOpenAICodex  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]  # 订阅协议接缝，契约测试守护
):
    """沿用订阅认证与请求约束，在响应终态结算工具调用。"""

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        """读取订阅响应。Args: messages, stop, run_manager, kwargs。"""
        token = await self.token_provider.aget_token()
        kwargs["_codex_headers"] = self._build_headers(token.account_id)
        payload = cast(
            "dict[str, Any]",
            self._get_request_payload(  # pyright: ignore[reportUnknownMemberType]  # 上游返回裸 dict，在此收窄
                messages, stop=stop, **kwargs
            ),
        )
        raw = await self.root_async_client.with_raw_response.responses.create(
            **payload
        )
        decoder = ResponseDecoder(
            output_version=self.output_version,
            headers=(
                {"headers": dict(raw.headers)}
                if self.include_response_headers
                else {}
            ),
        )
        async with raw.parse() as response:
            async for (
                event
            ) in base._astream_with_chunk_timeout(  # noqa: SLF001  # pyright: ignore[reportPrivateUsage, reportPrivateImportUsage]  # 保留上游逐块超时
                response,
                self.stream_chunk_timeout,
                model_name=self.model_name,
            ):
                chunk = decoder.decode(event)
                if chunk is not None:
                    if run_manager is not None:
                        await run_manager.on_llm_new_token(
                            chunk.text, chunk=chunk
                        )
                    yield chunk
        if not decoder.is_finished:
            raise ModelUnavailable("模型响应未完整返回，请重新发起回合")


@dataclass
class ResponseDecoder:
    """一次响应的文本索引与终态工具结算。"""

    output_version: str | None
    headers: dict[str, object]
    current_index: int = -1
    output_index: int = -1
    sub_index: int = -1
    is_finished: bool = False
    has_reasoning: bool = False
    content: ContentTracker = field(default_factory=ContentTracker)
    items: OutputItems = field(default_factory=OutputItems)

    def decode(self, event: ResponseStreamEvent) -> ChatGenerationChunk | None:
        """沿用正文转换，仅在响应完成后输出工具。Args: event。"""
        if self.is_finished:
            return None
        if isinstance(event, ResponseOutputItemAddedEvent):
            self.items.added(event)
        if isinstance(
            event, ResponseOutputItemDoneEvent
        ) and not self.items.record(event):
            return None
        if _is_function_event(event):
            return None
        tools = None
        missing = None
        if isinstance(event, ResponseCompletedEvent | ResponseIncompleteEvent):
            missing, tools = self._terminal_content(event.response)
            self.is_finished = True
        chunk = self._convert(event)
        if chunk is not None:
            if missing is not None:
                chunk.message = chunk.message + missing
            if tools is not None:
                chunk.message = chunk.message + tools
        return chunk

    def _terminal_content(
        self, terminal: Response
    ) -> tuple[AIMessageChunk, AIMessageChunk]:
        response = self.items.merge(terminal)
        _log_terminal(response, self.content, len(terminal.output))
        missing, self.current_index = self.content.finish(
            response, self.current_index, self.output_version
        )
        return missing, _final_tools(response, self.current_index + 1)

    def _convert(
        self, event: ResponseStreamEvent
    ) -> ChatGenerationChunk | None:
        self.current_index, self.output_index, self.sub_index, chunk = (
            base._convert_responses_chunk_to_generation_chunk(  # noqa: SLF001  # pyright: ignore[reportPrivateUsage, reportUnknownMemberType]  # 上游裸 dict，输出由 HTTP 契约测试守护
                event,
                self.current_index,
                self.output_index,
                self.sub_index,
                metadata=self.headers,
                has_reasoning=self.has_reasoning,
                output_version=self.output_version,
            )
        )
        if chunk is not None:
            self.headers = {}
            if "reasoning" in chunk.message.additional_kwargs:
                self.has_reasoning = True
            if not self.is_finished:
                self.content.record(event, self.current_index)
        return chunk


def _log_terminal(
    response: Response, content: ContentTracker, terminal_count: int
) -> None:
    """记录有界结构元数据，正文与参数不入日志。Args: response, content。"""
    _logger.info(
        "codex_response_terminal",
        "订阅模型响应终态",
        status=response.status,
        terminal_output_count=terminal_count,
        merged_output_count=len(response.output),
        output_types=",".join(sorted({item.type for item in response.output})),
        function_count=sum(
            item.type == "function_call" for item in response.output
        ),
        text_chars=sum(
            len(part.text)
            for item in response.output
            if item.type == "message"
            for part in item.content
            if part.type == "output_text"
        ),
        reasoning_chars=sum(
            len(part.text)
            for item in response.output
            if item.type == "reasoning"
            for part in item.summary
        ),
        streamed_text_chars=sum(
            len(piece.text) for piece in content.texts.values()
        ),
        streamed_reasoning_chars=sum(
            len(piece.text) for piece in content.summaries.values()
        ),
    )


def _is_function_event(event: ResponseStreamEvent) -> bool:
    """识别尚未结算的函数调用事件。Args: event。"""
    if event.type in (
        "response.function_call_arguments.delta",
        "response.function_call_arguments.done",
    ):
        return True
    return (
        isinstance(
            event, ResponseOutputItemAddedEvent | ResponseOutputItemDoneEvent
        )
        and event.item.type == "function_call"
    )


def _final_tools(response: Response, start_index: int) -> AIMessageChunk:
    """从终态提取完整函数调用。Args: response, start_index。"""
    calls: list[ToolCallChunk] = []
    content: list[str | dict[str, Any]] = []
    identities: set[str] = set()
    for item in response.output:
        if item.type != "function_call":
            continue
        if response.status != "completed" or item.status != "completed":
            raise ModelUnavailable("模型工具调用未完整返回，请重新发起回合")
        _check_arguments(item.arguments)
        if not item.name or not item.call_id or item.call_id in identities:
            raise ModelUnavailable("模型工具调用身份重复或缺失")
        identities.add(item.call_id)
        index = start_index + len(calls)
        calls.append(
            tool_call_chunk(
                name=item.name,
                args=item.arguments,
                id=item.call_id,
                index=index,
            )
        )
        content.append(
            {**item.model_dump(exclude_none=True, mode="json"), "index": index}
        )
    return AIMessageChunk(content=content, tool_call_chunks=calls)


def _check_arguments(arguments: str) -> None:
    """拒绝截断 JSON 与非对象参数。Args: arguments。"""
    try:
        loaded = cast("object", json.loads(arguments))
    except ValueError as error:
        raise ModelUnavailable("模型工具参数不是完整 JSON") from error
    if not isinstance(loaded, dict):
        raise ModelUnavailable("模型工具参数必须是 JSON 对象")
