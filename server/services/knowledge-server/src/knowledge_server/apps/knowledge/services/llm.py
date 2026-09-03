"""知识库这一侧的模型调用面：窄到只有一个动作。

⚠ 只暴露 `complete(system, user) -> str`，不把 langchain 的类型漏进检索层：
检索策略只该认「问一句、拿一段话」，认了消息类型之后换库就要改策略。

⚠ 与助手那一侧**不共用调用外壳**：那一侧要流式、要工具，而这一路一样都不要。
共用的是 `domain/llmcore`——端点形状、适配器、失败分档、断路器的判据
（ADR-0032 决策三 / ADR-0041）。

⚠ 这一层**不重试**：一条链路只有一层负责重试，而那一层是编排层。

⚠ 走哪一路来自运行期可改的目录（ADR-0039 / ADR-0040）：`can_answer` 问的是
**此刻**装不装得出适配器，`complete` 调用前先让目录刷新一次。这一层只认一个
「对话模型适配器」协议，不认那一路是端点还是订阅账号——认了就要为每加一种
接入形态在这里写一条分支。
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol, cast, runtime_checkable

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from openai import OpenAIError

from lib.logging import get_logger
from lib.resilience import BreakerOpen, CircuitBreaker
from llmcore import ChatEndpoint, ModelChoice, OpenAiCompatAdapter
from llmcore.errors import ModelUnavailable, classified, is_our_fault
from llmcore.ports import ModelKind

_logger = get_logger("knowledge.llm")

Refresh = Callable[[], Awaitable[object]]


class AnswerUnavailable(RuntimeError):
    """这套部署没接对话档。

    ⚠ 抛而不是回空串：回空串的话，调用方会把「没接模型」当成「模型没话说」，
    然后把一个空答案交给用户。
    """


@runtime_checkable
class ChatAdapter(Protocol):
    """一路对话模型：吃不吃这一档、按这次选择造一个模型。

    ⚠ 收窄到这两问而不是直接认某个具体类：这一侧接得了的接入形态是一张表
    （`llm_adapters.KIND_BUILDERS`），认具体类等于每加一种形态就要改这一层，
    而漏改的表现是「界面上分配了、这一侧却还在用环境变量那一档」。
    """

    def supports(self, kind: ModelKind) -> bool:
        """这一路吃不吃这一档。

        Args: kind。
        """
        ...

    async def build(self, choice: ModelChoice) -> BaseChatModel:
        """按这次选择造一个可调用的模型。

        Args: choice。
        """
        ...


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
    """走目录此刻指的那一路，外面包一层断路器。"""

    adapter: ChatAdapter
    breaker: CircuitBreaker
    # 调用前先让目录刷新一次；没接目录就是 None
    refresh: Refresh | None = None

    @property
    def can_answer(self) -> bool:
        """此刻装得出对话模型吗。"""
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
    endpoint: ChatEndpoint | ChatAdapter | None,
    breaker: CircuitBreaker,
    *,
    refresh: Refresh | None = None,
) -> Answerer:
    """按端点（或已装好的适配器）装一路对话档；没配就给 `NullAnswerer`。

    Args: endpoint（定死的端点，或按目录挑那一路的适配器）, breaker,
        refresh（调用前让目录刷新一次的口子）。
    """
    if endpoint is None:
        return NullAnswerer()
    if not isinstance(endpoint, ChatEndpoint):
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
