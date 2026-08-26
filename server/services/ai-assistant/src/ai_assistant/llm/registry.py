"""这套部署接了哪几路模型，以及按名字取出其中一路。

⚠ 取模型是**异步**的：订阅账号那一路要先拿一个此刻能用的令牌，而那可能触发
一次续期。做成同步的话，续期只能在事件循环里阻塞地等一次网络往返。

⚠ 认不出的档位名一律退回默认那一路，而不是抛：会话里存着的档位名可能是上一版
配置留下的，那时正确的行为是照常能说话，不是整个会话打不开。
"""

from dataclasses import dataclass

from langchain_core.language_models import BaseChatModel

from ai_assistant.llm.codex import StoredTokenProvider, build_codex_model
from ai_assistant.llm.codex.token_provider import TokenSource
from ai_assistant.llm.errors import ModelDisabled
from ai_assistant.llm.provider import ModelChoice, build_model_source
from ai_assistant.settings import Settings

# 按 API Key 计费那一路的档位名。⚠ 是线上契约的一部分：前端按它记住用户的选择
DEFAULT_PROFILE = "default"
CODEX_PROFILE = "codex"


@dataclass(frozen=True)
class ModelProfile:
    """一路模型在能力面上的样子。"""

    id: str
    label: str
    # 这一路能不能马上用。为假时前端把它灰着并指向系统页
    is_ready: bool
    has_vision: bool
    # 可选的模型代号，第一个是默认
    models: tuple[str, ...]
    # 可选的推理档位；空表示这一路没有这一档可调
    efforts: tuple[str, ...]


class ModelRegistry:
    """按档位名取模型。一个进程一份。"""

    def __init__(
        self, settings: Settings, *, tokens: TokenSource | None
    ) -> None:
        """Args: settings, tokens（订阅账号那一路的凭据面；没接就是 None）。"""
        self._settings = settings
        self._tokens = tokens
        self._openai = build_model_source(settings)

    def profiles(self) -> tuple[ModelProfile, ...]:
        """这套部署接了哪几路。没接的一路根本不出现在清单里。"""
        found: list[ModelProfile] = []
        if self._openai is not None:
            found.append(
                ModelProfile(
                    id=DEFAULT_PROFILE,
                    label="按量计费端点",
                    is_ready=True,
                    has_vision=bool(self._settings.model_vision),
                    models=(self._settings.model_chat,),
                    efforts=(),
                )
            )
        if self._tokens is not None:
            found.append(
                ModelProfile(
                    id=CODEX_PROFILE,
                    label="订阅账号",
                    # ⚠ 装配得起来不代表登录过：真假由凭据面在能力端点上补
                    is_ready=True,
                    # 这一路眼下不接图：截图那条链路只在按量那一路验过
                    has_vision=False,
                    models=self._settings.codex_model_choices(),
                    efforts=("low", "medium", "high", "xhigh"),
                )
            )
        return tuple(found)

    def default_id(self) -> str:
        """没选过时用哪一路。"""
        listed = self.profiles()
        return listed[0].id if listed else DEFAULT_PROFILE

    def resolves(self, profile_id: str) -> bool:
        """这个档位名此刻取得出模型吗。

        Args: profile_id。
        """
        return any(one.id == profile_id for one in self.profiles())

    async def resolve(self, choice: ModelChoice) -> BaseChatModel:
        """按选择取一路模型。

        ⚠ 认不出的名字退回默认那一路：会话里存的名字可能来自上一版配置。

        Args: choice。
        """
        if choice.profile == CODEX_PROFILE and self._tokens is not None:
            return await self._codex(choice.effort)
        if self._openai is None:
            raise ModelDisabled("本部署没有接模型")
        return self._openai(choice.kind)

    async def _codex(self, effort: str | None) -> BaseChatModel:
        # ⚠ 先摸一次令牌：没登录过就在这里失败，而不是等模型端点回 401——
        # 后者报出来的是「模型暂时不可用」，与「去登录一下」完全对不上
        source = self._tokens
        # pragma 理由：调用方在进这条分支前已经判过 `_tokens is not None`
        if source is None:  # pragma: no cover
            raise ModelDisabled("本部署没有接订阅账号那一路模型")
        await source.usable(CODEX_PROFILE)
        settings = self._settings
        chosen = settings.codex_model_choices()
        return build_codex_model(
            model=chosen[0] if chosen else settings.codex_model,
            token_provider=StoredTokenProvider(source),
            effort=effort or settings.codex_reasoning_effort,
            timeout_s=settings.model_timeout_s,
        )
