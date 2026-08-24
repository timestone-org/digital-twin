"""模型调用的外壳：断路、超时归因、失败分档。

⚠ **哪一档失败该让断路器打开，是这个文件里最要紧的判断。**
超时、连不上、限流、5xx 是「下游此刻不行」——该打开，短路能省下白等的时间。
401 与 400 是「我们自己配错了或发错了」——**绝不能打开**：断路器一开，
真正的原因就被盖成「暂时不可用」，而那会让人去查网络。
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.tools import BaseTool
from openai import (
    APIConnectionError,
    APIStatusError,
    AuthenticationError,
    BadRequestError,
    OpenAIError,
    PermissionDeniedError,
)

from ai_assistant.llm.errors import ModelRejected, ModelUnavailable
from ai_assistant.llm.provider import ChatModelSource, ModelKind
from lib.logging import get_logger
from lib.resilience import BreakerOpen, CircuitBreaker

_logger = get_logger("assistant.llm")

# 这几档说明「是我们发错了」，重试与短路都没有意义
_OUR_FAULT = (AuthenticationError, PermissionDeniedError, BadRequestError)


@dataclass(frozen=True)
class GuardedModel:
    """带断路器的模型调用面。"""

    source: ChatModelSource
    breaker: CircuitBreaker

    async def respond(
        self,
        *,
        kind: ModelKind,
        messages: list[BaseMessage],
        tools: Sequence[dict[str, Any] | BaseTool],
    ) -> AIMessage:
        """要一次补全。工具为空时就是纯对话。

        ⚠ 工具收的是**声明**而不是可执行件：客户端工具压根没有服务端实现，
        模型只需要一份能让它正确调用的形状描述。

        Args: kind, messages, tools。
        """
        self._guard()
        model = self.source(kind)
        bound = model.bind_tools(list(tools)) if tools else model
        try:
            reply = await bound.ainvoke(messages)
        except _OUR_FAULT as error:
            raise ModelRejected(_reason(error)) from error
        except OpenAIError as error:
            self.breaker.record_failure(type(error).__name__)
            raise ModelUnavailable(_reason(error)) from error
        self.breaker.record_success()
        return _as_ai_message(reply)

    def _guard(self) -> None:
        try:
            self.breaker.guard()
        except BreakerOpen as error:
            _logger.warning(
                "model_short_circuited", "断路器打开着，本次没有发出去"
            )
            raise ModelUnavailable("模型暂时不可用") from error


def _as_ai_message(reply: BaseMessage) -> AIMessage:
    """把回包收成 `AIMessage`。

    ⚠ 收不成就抛而不是造一个空的：造空的会让编排层以为模型「什么都没说」，
    于是回合正常结束、界面上是一条空气泡。

    Args: reply。
    """
    if isinstance(reply, AIMessage):
        return reply
    raise ModelUnavailable("模型回包不是一条助手消息")


def _reason(error: OpenAIError) -> str:
    """给人看的失败原因。

    ⚠ 只带异常类型与状态码，**不带 URL、密钥与响应体原文**：这句话会显示在
    界面上（api-contract §4.2）。

    Args: error。
    """
    if isinstance(error, APIConnectionError):
        return "连不上模型端点"
    if isinstance(error, AuthenticationError):
        return "模型端点拒绝了凭据"
    if isinstance(error, PermissionDeniedError):
        return "模型端点拒绝了这次调用"
    if isinstance(error, BadRequestError):
        return "模型端点认为请求不合法"
    if isinstance(error, APIStatusError):
        return f"模型端点回了 {error.status_code}"
    return "模型端点未响应"
