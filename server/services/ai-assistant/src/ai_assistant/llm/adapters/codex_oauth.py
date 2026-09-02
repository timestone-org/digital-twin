"""订阅账号那一形态：用 ChatGPT 订阅直连 Codex 后端（ADR-0026）。

目录里配出来的每一路各是一个适配器，环境变量配的那一路也是同一个类型——
差别只在「模型清单与推理档位从哪儿来」，接法一模一样。

⚠ **这一路不接图。** `supports("vision")` 恒假，由注册表据此如实拒绝——
截图那条链路只在端点那一形态上验过。放行的话，图会被喂给一个自报不接图的
模型，而它多半只回一句「我没看到图」：调用成功、照常计费、结论是错的。

⚠ 登录态**不在目录里**：令牌要在每次调用前可续期，故它落在本服务的凭据表上，
按这一路的档位名认行（`apps/credential`）。
"""

from dataclasses import dataclass
from typing import Any

from langchain_core.language_models import BaseChatModel

from ai_assistant.llm.codex import StoredTokenProvider, build_codex_model
from ai_assistant.llm.codex.token_provider import TokenSource
from ai_assistant.llm.ports import (
    CODEX_EFFORTS,
    CODEX_PROFILE,
    ModelChoice,
    ModelKind,
    ModelProfile,
)
from ai_assistant.settings import Settings
from llmcore import MODEL_KIND_CHAT, ProviderSpec

# 推理档位配在形态自己那几格里。⚠ 与 platform-server 的
# `apps/llm_providers/rules.py` 逐字一致：拼错的那一格读不出来，
# 表现是「配了 high、发出去的还是 medium」
OPTION_DEFAULT_EFFORT = "default_effort"


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

    def supports(self, kind: ModelKind) -> bool:
        """吃对话档与摘要档，不吃视觉档。

        ⚠ 摘要档也吃：折叠是一次纯文本调用，这一路做得了。不吃的话，一个只
        登录了订阅账号的部署永远折不出摘要，而它表现为「摘要偶尔就是没有」。

        ⚠ 一个模型都没登记的那一路**哪一档都不吃**：发一次空模型名过去是一条
        400，而那条 400 里不会提到是「这一路上还没登记模型」。

        Args: kind。
        """
        return bool(self.models) and kind in ("chat", "summary")

    async def build(self, choice: ModelChoice) -> BaseChatModel:
        """先摸一次令牌，再造模型。

        ⚠ 先摸令牌：没登录过就在这里失败，而不是等模型端点回 401——后者报出来
        的是「模型暂时不可用」，与「去登录一下」完全对不上。

        Args: choice。
        """
        seed = await self.tokens.usable(self.id)
        return build_codex_model(
            model=self.models[0],
            # ⚠ 刚摸到的那一份直接当快照：上游把 api_key 焊成同步可调用件，
            # 第一次请求会从执行器线程回来要它
            token_provider=StoredTokenProvider(self.tokens, seed=seed),
            effort=choice.effort or self.default_effort,
            timeout_s=self.timeout_s,
        )

    def profile(self) -> ModelProfile:
        """这一路在能力面上的样子。"""
        return ModelProfile(
            id=self.id,
            label=self.label,
            # ⚠ 装配得起来不代表登录过：真假由凭据面在能力端点上补
            is_ready=True,
            # 这一路眼下不接图：截图那条链路只在端点那一形态上验过
            has_vision=False,
            models=self.models,
            efforts=CODEX_EFFORTS,
        )


def build_catalog_codex(
    provider: ProviderSpec, settings: Settings, tokens: TokenSource | None
) -> CodexOAuthAdapter | None:
    """目录里的一路订阅账号。没接凭据面时给 `None`——那时登录都无处可存。

    Args: provider, settings, tokens。
    """
    if tokens is None:
        return None
    return CodexOAuthAdapter(
        id=provider.id,
        label=provider.name,
        models=tuple(one.name for one in provider.models_of(MODEL_KIND_CHAT)),
        default_effort=(
            _effort_of(provider.options) or settings.codex_reasoning_effort
        ),
        timeout_s=settings.model_timeout_s,
        tokens=tokens,
    )


def build_env_codex(
    settings: Settings, tokens: TokenSource | None
) -> CodexOAuthAdapter | None:
    """环境变量配出来的那一路。没接凭据面、或没配模型代号时给 `None`——
    那时这一路就是没接。

    ⚠ 它是目录的永久默认值：目录里一路订阅型供应商都没有时才轮到它。

    Args: settings, tokens。
    """
    choices = settings.codex_model_choices()
    if tokens is None or not choices:
        return None
    return CodexOAuthAdapter(
        id=CODEX_PROFILE,
        label="订阅账号",
        models=choices,
        default_effort=settings.codex_reasoning_effort,
        timeout_s=settings.model_timeout_s,
        tokens=tokens,
    )


def _effort_of(options: dict[str, Any] | None) -> str | None:
    """这一路配的推理档位；没配或配得不成形时给 `None`。

    ⚠ 防着读：这一格要原样进请求体，塞个数字进去是一条 400，
    而那条 400 里不会提到是哪一格。

    Args: options。
    """
    if not options:
        return None
    found = options.get(OPTION_DEFAULT_EFFORT)
    if not isinstance(found, str) or found not in CODEX_EFFORTS:
        return None
    return found
