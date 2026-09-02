"""这套部署能接哪几路模型来源。

⚠ 注册是**显式的一步**（下面那个字面量元组），不靠 import 副作用（ADR-0029
决策四）：隐式注册会让「装了哪几路」取决于 import 顺序，而顺序在测试里与生产里
可以不同。加一路 = 加一个文件 + 这个元组里一行。

⚠ 顺序即优先级：`profiles()` 与「认不出的档位名退回第一路」都按它。

⚠ 按量那一路的端点**先问目录、再退环境变量**（ADR-0039）：目录是平台上配的
「各用途走哪一路模型」，运行期可改；环境变量是它的永久默认值。有目录时这一路
总是装得出来（此刻解不解得出端点由 `supports` 如实回答），没目录也没环境变量
时才不装。
"""

from collections.abc import Callable
from dataclasses import dataclass

from ai_assistant.llm.adapters.codex_oauth import (
    CodexOAuthAdapter,
    build_codex_oauth,
)
from ai_assistant.llm.codex.token_provider import TokenSource
from ai_assistant.llm.ports import (
    DEFAULT_PROFILE,
    PURPOSE_EMBEDDING,
    PURPOSE_OF_KIND,
    ModelAdapter,
    ModelKind,
)
from ai_assistant.settings import Settings
from llmcore import (
    CatalogSource,
    ChatEndpoint,
    DynamicEmbeddingAdapter,
    EmbeddingAdapter,
    EmbeddingEndpoint,
    OpenAiCompatAdapter,
)


@dataclass(frozen=True)
class AdapterDeps:
    """装一路来源要的那几样。

    ⚠ 打成一包而不是逐个形参：装配口子的形状要全部来源共用，而每多接一种
    东西（目录、凭据面）就要改每一路的签名。
    """

    settings: Settings
    # 订阅账号那一路的凭据面；没接就是 None
    tokens: TokenSource | None = None
    # 模型目录；没接就是 None（只有用例会这么装）
    catalog: CatalogSource | None = None


# 一路来源的装配口子。⚠ 接不上时给 `None` 而不是抛：那一路就是没接，
# 而整个服务在没接模型时仍然要能起、会话历史仍然要能读
AdapterBuilder = Callable[[AdapterDeps], ModelAdapter | None]


def resolve_chat_endpoint(
    deps: AdapterDeps, kind: ModelKind
) -> ChatEndpoint | None:
    """这一档此刻该打哪：目录里分配了就走目录，否则退环境变量那一档。

    ⚠ 回落链在这里逐格写全：目录里的用途与 `Settings.endpoint_of` 的档位一一
    对应，漏一格的表现是「界面上分配了看图模型，看图那一轮还在打旧地址」。

    Args: deps, kind。
    """
    if deps.catalog is not None:
        from_catalog = deps.catalog.snapshot().chat_endpoint(
            PURPOSE_OF_KIND[kind], timeout_s=_timeout_of(deps.settings, kind)
        )
        if from_catalog is not None:
            return from_catalog
    return deps.settings.endpoint_of(kind)


def resolve_embedding_endpoint(deps: AdapterDeps) -> EmbeddingEndpoint | None:
    """嵌入那一路此刻该打哪：目录优先，否则退环境变量。

    Args: deps。
    """
    if deps.catalog is not None:
        from_catalog = deps.catalog.snapshot().embedding_endpoint(
            PURPOSE_EMBEDDING,
            timeout_s=(
                deps.settings.embedding_timeout_s
                or deps.settings.model_timeout_s
            ),
        )
        if from_catalog is not None:
            return from_catalog
    return deps.settings.embedding_endpoint()


def build_openai_compat(deps: AdapterDeps) -> OpenAiCompatAdapter | None:
    """按量计费那一路。目录与环境变量都没接时给 `None`——这一路就是没接。

    Args: deps。
    """
    if deps.catalog is None and deps.settings.endpoint_of("chat") is None:
        return None

    def resolve(kind: ModelKind) -> ChatEndpoint | None:
        return resolve_chat_endpoint(deps, kind)

    return OpenAiCompatAdapter(
        resolve=resolve,
        label="按量计费端点",
        models=(deps.settings.model_chat,),
        id=DEFAULT_PROFILE,
    )


def build_openai_embedding(deps: AdapterDeps) -> EmbeddingAdapter | None:
    """嵌入那一路。目录与环境变量都没接时给 `None`——本部署可以只记不查。

    Args: deps。
    """
    if deps.catalog is None and deps.settings.embedding_endpoint() is None:
        return None
    catalog = deps.catalog
    return DynamicEmbeddingAdapter(
        resolve=lambda: resolve_embedding_endpoint(deps),
        refresh=None if catalog is None else catalog.refresh,
    )


def _timeout_of(settings: Settings, kind: ModelKind) -> float:
    """这一档的调用预算：看图那一档单配，别的档共用对话档的。

    Args: settings, kind。
    """
    if kind == "vision" and settings.vision_timeout_s is not None:
        return settings.vision_timeout_s
    return settings.model_timeout_s


def _openai(deps: AdapterDeps) -> ModelAdapter | None:
    return build_openai_compat(deps)


def _codex(deps: AdapterDeps) -> ModelAdapter | None:
    return build_codex_oauth(deps.settings, deps.tokens)


ADAPTER_BUILDERS: tuple[AdapterBuilder, ...] = (_openai, _codex)


def build_adapters(deps: AdapterDeps) -> tuple[ModelAdapter, ...]:
    """按配置装出这套部署真接得上的那几路，保持注册序。

    Args: deps。
    """
    found = [make(deps) for make in ADAPTER_BUILDERS]
    return tuple(one for one in found if one is not None)


__all__ = [
    "ADAPTER_BUILDERS",
    "AdapterBuilder",
    "AdapterDeps",
    "CodexOAuthAdapter",
    "OpenAiCompatAdapter",
    "build_adapters",
    "build_codex_oauth",
    "build_openai_compat",
    "build_openai_embedding",
    "resolve_chat_endpoint",
    "resolve_embedding_endpoint",
]
