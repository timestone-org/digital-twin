"""按脚本作答或抛错的假模型。

⚠ 它是真的 `BaseChatModel` 子类而不是随手拼的对象：被测代码会调 `bind_tools`，
鸭子类型的假件在类型上过不去，而放宽类型等于让用例不再守「我们调的是这套
接口」这件事。
"""

from collections.abc import Sequence
from typing import Any, cast

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import Runnable
from langchain_core.tools import BaseTool
from pydantic import ConfigDict, Field


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

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(
        self,
        tools: Sequence[dict[str, Any] | type | BaseTool],
        **kwargs: Any,
    ) -> Runnable[Any, AIMessage]:
        """假件不真绑工具，原样返回自己。

        Args: tools, kwargs。
        """
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


def tool_call(name: str, call_id: str, **arguments: Any) -> dict[str, Any]:
    """拼一个 langchain 认的工具调用字面量。

    Args: name, call_id, arguments。
    """
    return {"name": name, "args": dict(arguments), "id": call_id}


def asks(name: str, call_id: str, **arguments: Any) -> AIMessage:
    """造一条「要调某个工具」的助手消息。

    Args: name, call_id, arguments。
    """
    return AIMessage(
        content="", tool_calls=[tool_call(name, call_id, **arguments)]
    )
