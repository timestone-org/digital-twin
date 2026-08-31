"""按量计费的 OpenAI 兼容端点那一路。

⚠ 两档各自造各自的：端点、密钥、模型名、超时、方言键**逐格**取自
`Settings.endpoint_of(kind)`。共用一份的话，「对话走一家、看图走另一家」
只能靠改代码，而那正是 config-and-secrets §6 要避免的。
"""

from dataclasses import dataclass

from langchain_core.language_models import BaseChatModel

from ai_assistant.llm.ports import (
    DEFAULT_PROFILE,
    ModelChoice,
    ModelKind,
    ModelProfile,
)
from ai_assistant.llm.reasoning import ReasoningChatOpenAI
from ai_assistant.settings import Settings


@dataclass(frozen=True)
class OpenAiCompatAdapter:
    """按配置造 OpenAI 兼容对话模型的那一路。"""

    settings: Settings
    id: str = DEFAULT_PROFILE

    def supports(self, kind: ModelKind) -> bool:
        """这一档配得出端点就吃得下。

        Args: kind。
        """
        return self.settings.endpoint_of(kind) is not None

    async def build(self, choice: ModelChoice) -> BaseChatModel:
        """按这次选择造一个模型。

        ⚠ 这一路是同步造得出来的，签名仍是 async——`ModelAdapter` 的形状由
        订阅账号那一路定（它要先摸一次令牌，而那可能触发续期）。两路形状不一
        的话，注册表就要为它们各写一条分支。

        Args: choice。
        """
        endpoint = self.settings.endpoint_of(choice.kind)
        # pragma 理由：注册表在 `supports` 为假时不会走到这里
        if endpoint is None:  # pragma: no cover
            raise ValueError("这一档没有配得出的端点")
        return ReasoningChatOpenAI(
            base_url=endpoint.base_url,
            api_key=endpoint.api_key,
            model=endpoint.model,
            timeout=endpoint.timeout_s,
            # 端点方言里的额外请求体。⚠ 思考过程一类的开关在 OpenAI 兼容口径里
            # 没有标准字段，各家用自己的键——而代码里不认厂商名，于是它只能是
            # 一格配置（config-and-secrets §6）。留空即什么都不加
            extra_body=endpoint.extra_body,
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

    def profile(self) -> ModelProfile:
        """这一路在能力面上的样子。"""
        return ModelProfile(
            id=self.id,
            label="按量计费端点",
            is_ready=True,
            has_vision=self.supports("vision"),
            models=(self.settings.model_chat,),
            efforts=(),
        )


def build_openai_compat(settings: Settings) -> OpenAiCompatAdapter | None:
    """没开模型或没配密钥时给 `None`——这一路就是没接。

    Args: settings。
    """
    if settings.endpoint_of("chat") is None:
        return None
    return OpenAiCompatAdapter(settings=settings)
