"""按脚本作答或抛错的假模型。

⚠ 它是真的 `BaseChatModel` 子类而不是随手拼的对象：被测代码会调 `bind_tools`，
鸭子类型的假件在类型上过不去，而放宽类型等于让用例不再守「我们调的是这套
接口」这件事。
"""

from collections.abc import AsyncIterator, Sequence
from typing import Any, cast

from langchain_core.callbacks import (
    AsyncCallbackManagerForLLMRun,
    CallbackManagerForLLMRun,
)
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import (
    ChatGeneration,
    ChatGenerationChunk,
    ChatResult,
)
from langchain_core.runnables import Runnable
from langchain_core.tools import BaseTool
from pydantic import ConfigDict, Field

from llmcore.deltas import REASONING_KEY


class ScriptedChat(BaseChatModel):
    """按脚本逐轮作答，或抛一个写好的异常。

    `script` 非空时逐条弹出（用来演多轮工具调用）；空了之后退回 `reply`。
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    reply: BaseMessage = AIMessage(content="好的")
    script: list[BaseMessage] = Field(default_factory=list[BaseMessage])
    error: Exception | None = None
    calls: int = 0
    seen: list[list[BaseMessage]] = Field(
        default_factory=list[list[BaseMessage]]
    )
    # 绑过的工具声明。⚠ 记下来才守得住「发出去的名字长什么样」
    bound: list[dict[str, Any] | type | BaseTool] = Field(
        default_factory=list[dict[str, Any] | type | BaseTool]
    )

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(
        self,
        tools: Sequence[dict[str, Any] | type | BaseTool],
        **kwargs: Any,
    ) -> Runnable[Any, AIMessage]:
        """假件不真绑工具，只记下声明，原样返回自己。

        Args: tools, kwargs。
        """
        self.bound = list(tools)
        # ⚠ 收窄一次而不是压制类型：假件的产出永远是 `AIMessage`（`_generate`
        # 只造这一种），但基类的输出类型是 `BaseMessage`，直接返回过不去
        return cast("Runnable[Any, AIMessage]", self)

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        """按脚本作答，并记下这一轮看到的全部消息。

        Args: messages, stop, run_manager, kwargs。
        """
        self.calls += 1
        self.seen.append(list(messages))
        if self.error is not None:
            raise self.error
        message = self.script.pop(0) if self.script else self.reply
        return ChatResult(generations=[ChatGeneration(message=message)])


def tool_call(tool: str, call_id: str, /, **arguments: Any) -> dict[str, Any]:
    """拼一个 langchain 认的工具调用字面量。

    ⚠ `tool` 与 `call_id` 是位置限定的：工具入参里出现 `name` 是常事
    （`skills.load` 就收一个 `name`），不限定的话它会与形参撞上。
    Args: tool, call_id, arguments。
    """
    return {"name": tool, "args": dict(arguments), "id": call_id}


def asks(tool: str, call_id: str, /, **arguments: Any) -> AIMessage:
    """造一条「要调某个工具」的助手消息。

    Args: tool, call_id, arguments。
    """
    return AIMessage(
        content="", tool_calls=[tool_call(tool, call_id, **arguments)]
    )


class StreamingChat(BaseChatModel):
    """按块吐字的假件。

    ⚠ 真的实现 `_astream` 而不是让基类退化成「整条回一次」：被测的正是
    「一块一块来的东西怎么攒回一条」，而退化那条路上根本没有块。
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    # 每一块：(正文, 思考)。工具调用另给
    parts: list[tuple[str, str]] = Field(default_factory=list[tuple[str, str]])
    tool_chunks: list[dict[str, Any]] = Field(
        default_factory=list[dict[str, Any]]
    )
    error: Exception | None = None

    @property
    def _llm_type(self) -> str:
        return "streaming"

    def bind_tools(
        self,
        tools: Sequence[dict[str, Any] | type | BaseTool],
        **kwargs: Any,
    ) -> Runnable[Any, AIMessage]:
        """假件不真绑工具，原样返回自己。

        Args: tools, kwargs。
        """
        return cast("Runnable[Any, AIMessage]", self)

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        """非流式那条路：把全部块拼起来一次给完。

        Args: messages, stop, run_manager, kwargs。
        """
        said = "".join(text for text, _ in self.parts)
        return ChatResult(
            generations=[ChatGeneration(message=AIMessage(content=said))]
        )

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        """逐块吐。

        Args: messages, stop, run_manager, kwargs。
        """
        if self.error is not None:
            raise self.error
        for text, thought in self.parts:
            extra = {REASONING_KEY: thought} if thought else {}
            yield ChatGenerationChunk(
                message=AIMessageChunk(content=text, additional_kwargs=extra)
            )
        for call in self.tool_chunks:
            yield ChatGenerationChunk(
                message=AIMessageChunk(content="", tool_call_chunks=[call])
            )
