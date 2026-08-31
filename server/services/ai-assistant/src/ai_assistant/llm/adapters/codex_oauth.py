"""订阅账号那一路：用 ChatGPT 订阅直连 Codex 后端（ADR-0026）。

⚠ **这一路不接图。** `supports("vision")` 恒假，由注册表据此如实拒绝——
截图那条链路只在按量那一路验过。放行的话，图会被喂给一个自报不接图的模型，
而它多半只回一句「我没看到图」：调用成功、照常计费、结论是错的。
"""

from dataclasses import dataclass

from langchain_core.language_models import BaseChatModel

from ai_assistant.llm.codex import StoredTokenProvider, build_codex_model
from ai_assistant.llm.codex.token_provider import TokenSource
from ai_assistant.llm.ports import (
    CODEX_PROFILE,
    ModelChoice,
    ModelKind,
    ModelProfile,
)
from ai_assistant.settings import Settings


@dataclass(frozen=True)
class CodexOAuthAdapter:
    """订阅账号那一路。"""

    settings: Settings
    tokens: TokenSource
    id: str = CODEX_PROFILE

    def supports(self, kind: ModelKind) -> bool:
        """吃对话档与摘要档，不吃视觉档。

        ⚠ 摘要档也吃：折叠是一次纯文本调用，这一路做得了。不吃的话，一个只
        登录了订阅账号的部署永远折不出摘要，而它表现为「摘要偶尔就是没有」。

        Args: kind。
        """
        return kind in ("chat", "summary")

    async def build(self, choice: ModelChoice) -> BaseChatModel:
        """先摸一次令牌，再造模型。

        ⚠ 先摸令牌：没登录过就在这里失败，而不是等模型端点回 401——后者报出来
        的是「模型暂时不可用」，与「去登录一下」完全对不上。

        Args: choice。
        """
        seed = await self.tokens.usable(CODEX_PROFILE)
        settings = self.settings
        chosen = settings.codex_model_choices()
        return build_codex_model(
            model=chosen[0] if chosen else settings.codex_model,
            # ⚠ 刚摸到的那一份直接当快照：上游把 api_key 焊成同步可调用件，
            # 第一次请求会从执行器线程回来要它
            token_provider=StoredTokenProvider(self.tokens, seed=seed),
            effort=choice.effort or settings.codex_reasoning_effort,
            timeout_s=settings.model_timeout_s,
        )

    def profile(self) -> ModelProfile:
        """这一路在能力面上的样子。"""
        return ModelProfile(
            id=self.id,
            label="订阅账号",
            # ⚠ 装配得起来不代表登录过：真假由凭据面在能力端点上补
            is_ready=True,
            # 这一路眼下不接图：截图那条链路只在按量那一路验过
            has_vision=False,
            models=self.settings.codex_model_choices(),
            efforts=("low", "medium", "high", "xhigh"),
        )


def build_codex_oauth(
    settings: Settings, tokens: TokenSource | None
) -> CodexOAuthAdapter | None:
    """没接凭据面时给 `None`——这一路就是没接。

    Args: settings, tokens。
    """
    if tokens is None:
        return None
    return CodexOAuthAdapter(settings=settings, tokens=tokens)
