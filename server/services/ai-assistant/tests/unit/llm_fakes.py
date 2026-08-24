"""按脚本作答或抛错的假模型。

⚠ 它是真的 `BaseChatModel` 子类而不是随手拼的对象：被测代码会调
`bind_tools`，鸭子类型的假件在类型上过不去，而放宽类型等于让用例不再守
「我们调的是这套接口」这件事。
"""

from collections.abc import Sequence
from typing import Any, cast

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import Runnable
from langchain_core.tools import BaseTool
from pydantic import ConfigDict


class ScriptedChat(BaseChatModel):
    """要么回一条写好的消息，要么抛一个写好的异常。"""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    reply: BaseMessage = AIMessage(content="好的")
    error: Exception | None = None
    calls: int = 0

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
        """按脚本作答。

        Args: messages, stop, run_manager, kwargs。
        """
        self.calls += 1
        if self.error is not None:
            raise self.error
        return ChatResult(generations=[ChatGeneration(message=self.reply)])
