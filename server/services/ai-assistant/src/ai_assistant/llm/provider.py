"""模型接入：把配置拧成一个 OpenAI 兼容的对话模型。

⚠ 代码里**不认任何厂商名**。端点、模型名、超时全从配置来——换供应商是改一行
配置而不是改代码（config-and-secrets §6：环境差异只能是取值不能是行为）。

⚠ 模型没开时**不造对象、也不抛**：造不出来这件事由调用方按「能力缺席」处理，
与前端那套 ports 范式同一口径。抛在装配期会让整个服务起不来，而会话历史
在没有模型时仍然要能读。
"""

from dataclasses import dataclass
from typing import Literal, Protocol

from langchain_core.language_models import BaseChatModel

from ai_assistant.llm.reasoning import ReasoningChatOpenAI
from ai_assistant.settings import Settings

# 对话用与看图用分两档：视觉模型的单价与延迟都高得多，混成一档等于每次
# 对话都按视觉计费
ModelKind = Literal["chat", "vision"]


class ChatModelSource(Protocol):
    """按用途取一个模型。测试注一个假的进来，不打真端点。"""

    def __call__(self, kind: ModelKind) -> BaseChatModel: ...


# 没选过时走哪一路。⚠ 是线上契约的一部分：会话里存的就是这个字面量
DEFAULT_PROFILE = "default"
# 订阅账号那一路。⚠ 同上，也是线上契约的一部分
CODEX_PROFILE = "codex"


@dataclass(frozen=True)
class ModelChoice:
    """这一次调用要用哪一路模型。

    ⚠ 打成一包而不是三个形参：调用面的形参上限是 5，而 `respond` 还要收
    消息、工具与增量口子。
    """

    # 看图那一档单价与延迟都高得多，混成一档等于每次对话都按视觉计费
    kind: ModelKind = "chat"
    profile: str = DEFAULT_PROFILE
    # 推理档位；`None` 表示按这一路的配置默认
    effort: str | None = None


class ModelSource(Protocol):
    """按选择取一个模型。

    ⚠ 是**异步**的：订阅账号那一路要先拿一个此刻能用的令牌，而那可能触发一次
    续期——同步的话，续期只能在事件循环里阻塞地等一次网络往返。
    """

    async def __call__(self, choice: ModelChoice) -> BaseChatModel: ...


def build_model_source(settings: Settings) -> ChatModelSource | None:
    """按配置造模型工厂；没开模型时给 `None`。

    Args: settings。
    """
    key = settings.model_api_key
    if not settings.model_enabled or key is None:
        return None

    def source(kind: ModelKind) -> BaseChatModel:
        return ReasoningChatOpenAI(
            base_url=settings.model_base_url,
            api_key=key,
            model=_name_of(settings, kind),
            timeout=settings.model_timeout_s,
            # 端点方言里的额外请求体。⚠ 思考过程一类的开关在 OpenAI 兼容口径里
            # 没有标准字段，各家用自己的键——而代码里不认厂商名，于是它只能是
            # 一格配置（config-and-secrets §6）。留空即什么都不加
            extra_body=settings.extra_body(),
            # ⚠ 这一层不重试：一条链路只有一层负责重试，而那一层是编排层
            # （runtime-resilience §4.2）。留着 SDK 自带的重试会让一次超时
            # 变成三次，把上游的预算悄悄用光
            max_retries=0,
            # 流式回包里要用量那一格。⚠ **必须显式给。** 库只在用默认 OpenAI
            # 端点时才自己开它，而这里的端点一律来自配置——不给的话流式回包里
            # 连 usage 都没有，缓存命中与 token 消耗就一个都量不到，而「量不到」
            # 表现为一切正常。端点万一不认这一格，退路是关
            # `ASSISTANT_MODEL_STREAM_ENABLED`：非流式那一路本来就带用量
            stream_usage=True,
        )

    return source


def _name_of(settings: Settings, kind: ModelKind) -> str:
    return settings.model_vision if kind == "vision" else settings.model_chat
