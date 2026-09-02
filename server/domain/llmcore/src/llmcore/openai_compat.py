"""按量计费的 OpenAI 兼容对话端点那一路。

⚠ 每一档各自造各自的：端点、密钥、模型名、超时、方言键**逐格**由调用方按
`ModelKind` 解出来。共用一份的话，「对话走一家、看图走另一家」只能靠改代码，
而那正是「环境差异只能是取值不能是行为」要避免的。

⚠ 这一路**不认任何厂商名**，也不读任何配置对象：它只认一个
`ModelKind -> ChatEndpoint | None` 的解析口子，回落链由调用方算完。
"""

from collections.abc import Callable
from dataclasses import dataclass

from langchain_core.language_models import BaseChatModel

from llmcore.endpoints import ChatEndpoint
from llmcore.ports import (
    DEFAULT_PROFILE,
    ModelChoice,
    ModelKind,
    ModelProfile,
)
from llmcore.reasoning import ReasoningChatOpenAI

# 一档一档解端点的口子。⚠ 解不出即这一档没接，给 `None` 而不是抛
EndpointResolver = Callable[[ModelKind], ChatEndpoint | None]


@dataclass(frozen=True)
class OpenAiCompatAdapter:
    """按解析口子造 OpenAI 兼容对话模型的那一路。"""

    resolve: EndpointResolver
    # 能力面上显示的名字与可选模型代号。⚠ 由调用方给：它才知道自己把这一路
    # 叫什么，而这一层连厂商名都不认识
    label: str
    models: tuple[str, ...]
    id: str = DEFAULT_PROFILE

    def supports(self, kind: ModelKind) -> bool:
        """这一档解得出端点就吃得下。

        Args: kind。
        """
        return self.resolve(kind) is not None

    async def build(self, choice: ModelChoice) -> BaseChatModel:
        """按这次选择造一个模型。

        ⚠ 这一路是同步造得出来的，签名仍是 async——`ModelAdapter` 的形状由
        「要先摸一次令牌」的那些路定。两路形状不一的话，注册表就要为它们
        各写一条分支。

        Args: choice。
        """
        endpoint = self.resolve(choice.kind)
        # pragma 理由：注册表在 `supports` 为假时不会走到这里
        if endpoint is None:  # pragma: no cover
            raise ValueError("这一档没有解得出的端点")
        return ReasoningChatOpenAI(
            base_url=endpoint.base_url,
            api_key=endpoint.api_key,
            model=endpoint.model,
            timeout=endpoint.timeout_s,
            extra_body=endpoint.extra_body,
            # ⚠ 这一层不重试：一条链路只有一层负责重试，而那一层是调用方的
            # 编排层。留着 SDK 自带的重试会让一次超时变成三次，把上游的预算
            # 悄悄用光
            max_retries=0,
            # 流式回包里要用量那一格。⚠ **必须显式给。** 库只在用默认 OpenAI
            # 端点时才自己开它，而这里的端点一律来自配置——不给的话流式回包里
            # 连 usage 都没有，缓存命中与 token 消耗就一个都量不到，
            # 而「量不到」表现为一切正常
            stream_usage=True,
        )

    def profile(self) -> ModelProfile:
        """这一路在能力面上的样子。

        ⚠ 模型名按**此刻解出的端点**报，装配时给的清单只是没解出时的兜底：
        端点来自运行期可改的目录时，报装配时那一份会让界面上写着一个早已换掉
        的模型名。
        """
        endpoint = self.resolve("chat")
        return ModelProfile(
            id=self.id,
            label=self.label,
            is_ready=endpoint is not None,
            has_vision=self.supports("vision"),
            models=self.models if endpoint is None else (endpoint.model,),
            efforts=(),
        )
