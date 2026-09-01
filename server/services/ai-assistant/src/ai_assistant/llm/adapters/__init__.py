"""这套部署能接哪几路模型来源。

⚠ 注册是**显式的一步**（下面那个字面量元组），不靠 import 副作用（ADR-0029
决策四）：隐式注册会让「装了哪几路」取决于 import 顺序，而顺序在测试里与生产里
可以不同。加一路 = 加一个文件 + 这个元组里一行。

⚠ 顺序即优先级：`profiles()` 与「认不出的档位名退回第一路」都按它。
"""

from collections.abc import Callable

from ai_assistant.llm.adapters.codex_oauth import (
    CodexOAuthAdapter,
    build_codex_oauth,
)
from ai_assistant.llm.codex.token_provider import TokenSource
from ai_assistant.llm.ports import DEFAULT_PROFILE, ModelAdapter, ModelKind
from ai_assistant.settings import Settings
from llmcore import ChatEndpoint, OpenAiCompatAdapter
from llmcore.openai_embedding import (
    OpenAiCompatEmbeddingAdapter,
)
from llmcore.openai_embedding import (
    build_openai_embedding as _build_embedding,
)

# 一路来源的装配口子。⚠ 接不上时给 `None` 而不是抛：那一路就是没接，
# 而整个服务在没接模型时仍然要能起、会话历史仍然要能读
AdapterBuilder = Callable[[Settings, TokenSource | None], ModelAdapter | None]


def build_openai_compat(settings: Settings) -> OpenAiCompatAdapter | None:
    """按量计费那一路。没开模型或没配密钥时给 `None`——这一路就是没接。

    ⚠ 回落链（视觉档回落到对话档）已经由 `Settings.endpoint_of` 算完，
    这里只把那个口子递给 `llmcore`：适配器自己去读配置格子的话，
    那条链会在每一路里各写一遍，而写漏的那一份表现为「改了配置没生效」。

    Args: settings。
    """
    if settings.endpoint_of("chat") is None:
        return None

    def resolve(kind: ModelKind) -> ChatEndpoint | None:
        return settings.endpoint_of(kind)

    return OpenAiCompatAdapter(
        resolve=resolve,
        label="按量计费端点",
        models=(settings.model_chat,),
        id=DEFAULT_PROFILE,
    )


def build_openai_embedding(
    settings: Settings,
) -> OpenAiCompatEmbeddingAdapter | None:
    """嵌入那一路。没配就给 `None`——本部署可以只记不查。

    Args: settings。
    """
    return _build_embedding(settings.embedding_endpoint())


def _openai(
    settings: Settings, _tokens: TokenSource | None
) -> ModelAdapter | None:
    return build_openai_compat(settings)


def _codex(
    settings: Settings, tokens: TokenSource | None
) -> ModelAdapter | None:
    return build_codex_oauth(settings, tokens)


ADAPTER_BUILDERS: tuple[AdapterBuilder, ...] = (_openai, _codex)


def build_adapters(
    settings: Settings, tokens: TokenSource | None
) -> tuple[ModelAdapter, ...]:
    """按配置装出这套部署真接得上的那几路，保持注册序。

    Args: settings, tokens（订阅账号那一路的凭据面；没接就是 None）。
    """
    found = [make(settings, tokens) for make in ADAPTER_BUILDERS]
    return tuple(one for one in found if one is not None)


__all__ = [
    "ADAPTER_BUILDERS",
    "AdapterBuilder",
    "CodexOAuthAdapter",
    "OpenAiCompatAdapter",
    "OpenAiCompatEmbeddingAdapter",
    "build_adapters",
    "build_codex_oauth",
    "build_openai_compat",
    "build_openai_embedding",
]
