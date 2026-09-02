"""知识库这一侧的模型调用面：窄到只有一个动作。

⚠ 只暴露 `complete(system, user) -> str`，不把 langchain 的类型漏进检索层：
检索策略只该认「问一句、拿一段话」，认了消息类型之后换库就要改策略。

⚠ 与助手那一侧**不共用调用外壳**：那一侧要流式、要工具、要订阅账号的线形改写，
而这一侧一样都不要。共用的是 `domain/llmcore`——端点形状、失败分档、断路器
的判据（ADR-0032 决策三）。

⚠ 这一层**不重试**：一条链路只有一层负责重试，而那一层是编排层。

⚠ 端点来自运行期可改的目录（ADR-0039）：`can_answer` 问的是**此刻**解不解得出
端点，`complete` 调用前先让目录刷新一次。
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol, cast, runtime_checkable

from langchain_core.messages import HumanMessage, SystemMessage
from openai import OpenAIError

from lib.logging import get_logger
from lib.resilience import BreakerOpen, CircuitBreaker
from llmcore import ChatEndpoint, ModelChoice, OpenAiCompatAdapter
from llmcore.errors import ModelUnavailable, classified, is_our_fault

_logger = get_logger("knowledge.llm")

Refresh = Callable[[], Awaitable[object]]


class AnswerUnavailable(RuntimeError):
    """这套部署没接对话档。

    ⚠ 抛而不是回空串：回空串的话，调用方会把「没接模型」当成「模型没话说」，
    然后把一个空答案交给用户。
    """


@runtime_checkable
class Answerer(Protocol):
    """问一句、拿一段话。"""

    @property
    def can_answer(self) -> bool:
        """这一路此刻真能问吗。"""
        ...

    async def complete(self, system: str, user: str) -> str:
        """问一次。

        Args: system（这一步的规矩）, user（这一步的问题）。
        """
        ...


@dataclass(frozen=True)
class NullAnswerer:
    """没接对话档时的诚实缺席（ADR-0029 决策五）。"""

    can_answer: bool = False

    async def complete(self, system: str, user: str) -> str:
        """恒抛。

        Args: system, user。
        """
        del system, user
        raise AnswerUnavailable("这套部署没有接对话档")


@dataclass(frozen=True)
class ChatAnswerer:
    """走 OpenAI 兼容端点，外面包一层断路器。"""

    adapter: OpenAiCompatAdapter
    breaker: CircuitBreaker
    # 调用前先让目录刷新一次；没接目录就是 None
    refresh: Refresh | None = None

    @property
    def can_answer(self) -> bool:
        """此刻解得出对话端点吗。"""
        return self.adapter.supports("chat")

    async def complete(self, system: str, user: str) -> str:
        """问一次；失败分两档，只有「下游此刻不行」那一档让断路器计数。

        ⚠ 401 / 403 / 400 **绝不让断路器打开**：断路器一开，真正的原因
        （密钥配错了）就被盖成「暂时不可用」，而那会让人去查网络。

        Args: system, user。
        """
        if self.refresh is not None:
            await self.refresh()
        if not self.can_answer:
            raise AnswerUnavailable("这套部署没有接对话档")
        try:
            self.breaker.guard()
        except BreakerOpen as error:
            raise ModelUnavailable("模型暂时不可用") from error
        model = await self.adapter.build(ModelChoice())
        try:
            reply = await model.ainvoke(
                [SystemMessage(content=system), HumanMessage(content=user)]
            )
        except OpenAIError as error:
            if not is_our_fault(error):
                self.breaker.record_failure(type(error).__name__)
            raise classified(error) from error
        self.breaker.record_success()
        return _text_of(reply.content)


def _text_of(content: object) -> str:
    """把回包的正文摊成一段文本。

    ⚠ 内容可能是一串块而不是一个字符串（各家端点口径不同）。按字符串处理的话，
    那些端点回来的是一句 `[{'type': 'text', ...}]` 的字面量——看着像答案，
    实际上是一段 Python repr。

    Args: content。
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        # ⚠ 收窄一次：`isinstance` 从 `object` narrow 出来的是
        # `list[Unknown]`，直接遍历会把未知类型一路带进拼接
        rows = cast("list[object]", content)
        return "".join(
            str(cast("dict[str, object]", one).get("text", ""))
            for one in rows
            if isinstance(one, dict)
        )
    return ""


def build_answerer(
    endpoint: ChatEndpoint | OpenAiCompatAdapter | None,
    breaker: CircuitBreaker,
    *,
    refresh: Refresh | None = None,
) -> Answerer:
    """按端点（或已装好的适配器）装一路对话档；没配就给 `NullAnswerer`。

    Args: endpoint（定死的端点，或按目录解端点的适配器）, breaker,
        refresh（调用前让目录刷新一次的口子）。
    """
    if endpoint is None:
        return NullAnswerer()
    if isinstance(endpoint, OpenAiCompatAdapter):
        return ChatAnswerer(adapter=endpoint, breaker=breaker, refresh=refresh)
    fixed = endpoint
    return ChatAnswerer(
        adapter=OpenAiCompatAdapter(
            resolve=lambda _kind: fixed,
            label="知识库对话档",
            models=(fixed.model,),
        ),
        breaker=breaker,
        refresh=refresh,
    )
