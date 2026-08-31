"""模型调用的外壳：断路、超时归因、失败分档、逐字吐出去、记下用量。

⚠ **哪一档失败该让断路器打开，是这个文件里最要紧的判断。**
超时、连不上、限流、5xx 是「下游此刻不行」——该打开，短路能省下白等的时间。
401 与 400 是「我们自己配错了或发错了」——**绝不能打开**：断路器一开，
真正的原因就被盖成「暂时不可用」，而那会让人去查网络。

⚠ 流式与否**不改变这一层的产出**：两条路都回一条攒齐的 `AIMessage`，
增量只是顺路交给了口子。不这样的话，编排层要为两条路各写一遍「怎么读工具
调用」，而那两份一旦漂开，表现是「流式时工具调不出来」这种只在生产才复现
的故障。
"""

from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, BaseMessageChunk
from langchain_core.tools import BaseTool
from openai import (
    APIConnectionError,
    APIStatusError,
    AuthenticationError,
    BadRequestError,
    OpenAIError,
    PermissionDeniedError,
)

from ai_assistant.llm import deltas
from ai_assistant.llm.codex import wire_names
from ai_assistant.llm.deltas import DeltaSink
from ai_assistant.llm.errors import ModelRejected, ModelUnavailable
from ai_assistant.llm.ports import (
    CODEX_PROFILE,
    ModelChoice,
    ModelSource,
)
from lib.logging import get_logger
from lib.resilience import BreakerOpen, CircuitBreaker

_logger = get_logger("assistant.llm")

# 这几档说明「是我们发错了」，重试与短路都没有意义
_OUR_FAULT = (AuthenticationError, PermissionDeniedError, BadRequestError)


@dataclass(frozen=True)
class GuardedModel:
    """带断路器的模型调用面。"""

    source: ModelSource
    breaker: CircuitBreaker
    # 逐字流式的总开关。⚠ 关着时 `on_delta` 被忽略而不是报错：调用方不必
    # 为了「这套部署关了流式」再写一条分支
    is_streaming: bool = True
    # 每一个 (档位, 用途) 各有一份断路器。⚠ 共用一份的话，订阅账号那一路挂掉
    # 会把按量那一路一起短路，而后者本来好好的；**用途这一维同理**——看图那一档
    # 可以是另一家端点，它连挂几次不该把同一路的对话一起短路，而那时用户看到的
    # 是「助手整个不能说话了」
    breakers: Mapping[tuple[str, str], CircuitBreaker] = field(
        default_factory=dict[tuple[str, str], CircuitBreaker]
    )

    async def respond(
        self,
        *,
        choice: ModelChoice,
        messages: list[BaseMessage],
        tools: Sequence[dict[str, Any] | BaseTool],
        on_delta: DeltaSink | None = None,
    ) -> AIMessage:
        """要一次补全。工具为空时就是纯对话。

        ⚠ 工具收的是**声明**而不是可执行件：客户端工具压根没有服务端实现，
        模型只需要一份能让它正确调用的形状描述。

        ⚠ 给了 `on_delta` 才走流式。回的仍是攒齐的那一条——增量是顺路交出去
        的，不是替代品。

        Args: choice, messages, tools, on_delta。
        """
        breaker = self._breaker_of(choice)
        self._guard(breaker)
        model = await self.source(choice)
        # ⚠ 订阅账号那一路的端点不认工具名里的点号：出去的路上换掉，
        # 回来的路上换回来，两头都换才对得上（wire_names 文件头）
        if choice.profile == CODEX_PROFILE:
            tools = wire_names.wired_tools(tools)
            messages = wire_names.wired_messages(messages)
        bound = model.bind_tools(list(tools)) if tools else model
        sink = on_delta if self.is_streaming else None
        try:
            reply = (
                await bound.ainvoke(messages)
                if sink is None
                else await _drain(bound.astream(messages), sink)
            )
        except _OUR_FAULT as error:
            raise ModelRejected(_reason(error)) from error
        except OpenAIError as error:
            breaker.record_failure(type(error).__name__)
            raise ModelUnavailable(_reason(error)) from error
        breaker.record_success()
        answer = _as_ai_message(reply)
        if choice.profile == CODEX_PROFILE:
            answer = wire_names.restored(answer)
        _log_usage(choice, answer)
        return answer

    def _breaker_of(self, choice: ModelChoice) -> CircuitBreaker:
        """这一格 (档位, 用途) 自己那份断路器；没单独配就用兜底那一份。

        ⚠ 键是两维的。只按档位分的话，看图那一档换成另一家端点之后，
        它连挂几次会把同一路的对话一起短路掉。

        Args: choice。
        """
        return self.breakers.get(
            (choice.profile, choice.kind),
            self.breaker,
        )

    def _guard(self, breaker: CircuitBreaker) -> None:
        try:
            breaker.guard()
        except BreakerOpen as error:
            _logger.warning(
                "model_short_circuited", "断路器打开着，本次没有发出去"
            )
            raise ModelUnavailable("模型暂时不可用") from error


def usage_of(reply: AIMessage) -> dict[str, int] | None:
    """这一次调用花了多少 token、其中多少是命中前缀缓存的；端点没回就是 None。

    ⚠ `cache_read` 这个键名是 langchain 从 OpenAI 兼容口径的
    `prompt_tokens_details.cached_tokens` 映过来的。映法一变，这里静默变成 0，
    而 0 与「真的一次都没命中」长得一模一样——所以有一条用例钉着它。

    Args: reply。
    """
    usage = reply.usage_metadata
    if usage is None:
        return None
    details = usage.get("input_token_details") or {}
    return {
        "prompt": usage.get("input_tokens", 0),
        "cached": details.get("cache_read", 0),
        "output": usage.get("output_tokens", 0),
    }


def _log_usage(choice: ModelChoice, reply: AIMessage) -> None:
    """把这一次调用的用量记一条。

    ⚠ 没有这条日志，上下文工程就是盲的：前缀被打断这件事没有任何运行期迹象，
    只有账单和延迟会慢慢变难看。`cached` 逼近 `prompt` 才说明常驻提示词与工具
    声明真的被复用了。

    ⚠ 字段只有档位与几个数字：低基数，且不带任何请求内容（observability §3）。

    Args: choice, reply。
    """
    fields = usage_of(reply)
    tags = {"kind": choice.kind, "profile": choice.profile}
    if fields is None:
        _logger.debug("model_usage_absent", "端点没回用量", **tags)
        return
    _logger.info("model_call_usage", "一次模型调用的用量", **tags, **fields)


async def _drain(
    stream: AsyncIterator[BaseMessage], sink: DeltaSink
) -> BaseMessage:
    """收完一条流：每块顺手交给口子，最后把它们攒成一条。

    ⚠ 攒的是**块的加法**而不是自己拼字符串：工具调用在流里是逐段来的
    （函数名一块、参数的前半截一块、后半截又一块），自己拼只能拼出正文，
    而工具调用会整批丢掉——表现是「模型只会说话不会动手」。

    ⚠ 一块都没来时上游抛的是 `ValueError` 而不是 `OpenAIError`。不接住的话
    它会穿过整个编排层，最后表现为**流突然断掉、界面上没有任何错**——
    而 `:advance` 只把 `AppError` 落成 error 事件。

    Args: stream, sink。
    """
    merged: BaseMessage | None = None
    try:
        async for part in stream:
            deltas.emit(part, sink)
            merged = _join(merged, part)
    except ValueError as error:
        raise ModelUnavailable("模型没有回任何内容") from error
    if merged is None:
        raise ModelUnavailable("模型没有回任何内容")
    return merged


def _join(merged: BaseMessage | None, part: BaseMessage) -> BaseMessage:
    """把新的一块并进已有的。

    ⚠ 只有块与块之间有加法。不带流式实现的模型（用例里的假件就是）在
    `astream` 上退化成「整条回一次」，那一条是普通消息而不是块——那时直接
    用它，而不是让整条流栽在一个 `TypeError` 上。

    Args: merged, part。
    """
    if merged is None:
        return part
    if isinstance(merged, BaseMessageChunk) and isinstance(
        part, BaseMessageChunk
    ):
        return merged + part
    return part


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
