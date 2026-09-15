"""订阅账号适配器，按消费方提供的用途模型表声明能力并构造请求。

凭据归平台持有，见 ADR-0041。
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from langchain_core.language_models import BaseChatModel

from llmcore.codex.model import build_codex_model
from llmcore.codex.tokens import StoredTokenProvider, TokenSource
from llmcore.errors import ModelRejected
from llmcore.ports import ModelChoice, ModelKind, ModelProfile

# 推理档位配在形态自己那几格里。⚠ 与 platform-server 的
# `apps/llm_providers/rules.py` 逐字一致：拼错的那一格读不出来，
# 表现是「配了 high、发出去的还是 medium」
OPTION_DEFAULT_EFFORT = "default_effort"

# 这一路可调的推理档位。⚠ 与 platform-server 的 `enums.py` 逐字一致：漂开的
# 表现是界面上选得中的档位被端点回一条 400，而那条 400 里不会提到是哪一格
CODEX_EFFORTS: tuple[str, ...] = ("low", "medium", "high", "xhigh")

# 这一路吃得下的那几档。⚠ 摘要档也吃：折叠是一次纯文本调用，这一路做得了。
# 不吃的话，一个只登录了订阅账号的部署永远折不出摘要，而它表现为
# 「摘要偶尔就是没有」
_KINDS: tuple[ModelKind, ...] = ("chat", "summary")


@dataclass(frozen=True)
class CodexOAuthAdapter:
    """一路订阅账号。"""

    id: str
    label: str
    models: tuple[str, ...]
    # 没在这次调用里选档位时用哪一档
    default_effort: str
    timeout_s: float
    tokens: TokenSource
    # 请求头里的来路标识。⚠ 由消费方给：出了事要能从对面的日志里认出是哪个
    # 服务发的，而这一层连自己在哪个服务里都不该知道
    originator: str
    # 界面上摆得出来的推理档位；空表示这一侧不给人选
    efforts: tuple[str, ...] = field(default=())
    models_by_kind: Mapping[ModelKind, str] | None = None

    def model_for(self, kind: ModelKind) -> str | None:
        """取本路中适用的已登记模型。Args: kind。"""
        if self.models_by_kind is not None:
            model = self.models_by_kind.get(kind)
            return model if model in self.models else None
        return self.models[0] if self.models and kind in _KINDS else None

    def supports(self, kind: ModelKind) -> bool:
        """是否有适用的已登记模型。Args: kind。"""
        return self.model_for(kind) is not None

    async def build(self, choice: ModelChoice) -> BaseChatModel:
        """先领一次令牌，再造模型。

        ⚠ 先领令牌：没登录过就在这里失败，而不是等模型端点回 401——后者报出来
        的是「模型暂时不可用」，与「去登录一下」完全对不上。

        Args: choice。
        """
        model = self.model_for(choice.kind)
        if model is None:
            raise ModelRejected("这一路没有适用于当前用途的模型")
        seed = await self.tokens.usable(self.id)
        return build_codex_model(
            model=model,
            # ⚠ 刚领到的那一份直接当快照：上游把 api_key 焊成同步可调用件，
            # 第一次请求会从执行器线程回来要它
            token_provider=StoredTokenProvider(self.tokens, self.id, seed=seed),
            effort=choice.effort or self.default_effort,
            timeout_s=self.timeout_s,
            originator=self.originator,
        )

    def profile(self) -> ModelProfile:
        """这一路在能力面上的样子。"""
        return ModelProfile(
            id=self.id,
            label=self.label,
            # ⚠ 装配得起来不代表登录过：真假由凭据面在能力端点上补
            is_ready=True,
            has_vision=self.supports("vision"),
            models=self.models,
            efforts=self.efforts,
        )


def effort_of(
    options: Mapping[str, Any] | None, allowed: tuple[str, ...]
) -> str | None:
    """这一路配的推理档位；没配或配得不成形时给 `None`。

    ⚠ 防着读：这一格要原样进请求体，塞个数字进去是一条 400，
    而那条 400 里不会提到是哪一格。

    Args: options, allowed（这一侧认的那几档）。
    """
    if not options:
        return None
    found = options.get(OPTION_DEFAULT_EFFORT)
    if not isinstance(found, str) or found not in allowed:
        return None
    return found
