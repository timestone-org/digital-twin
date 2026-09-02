"""这套部署接得上哪几路模型，以及一路供应商怎么变成一个适配器。

⚠ **形态 → 装配口子**的注册表是显式的一份字面量表（ADR-0029 决策四），不靠
import 副作用：隐式注册会让「接得了哪几种」取决于 import 顺序，而顺序在测试里
与生产里可以不同。接一种新形态 = 加一个文件 + 这张表里一行 + 一条契约测试。

⚠ 认不出的形态**如实缺席**而不是猜着接：平台那边加了一档而这一侧还没接时，
正确的行为是「界面上配得出、助手说这一路我接不了」，不是拿端点那一路的接法
去打一个根本不是那么接的地方。

⚠ 环境变量那两路是目录的**永久默认值**（config-and-secrets §7.1）：目录里有了
同一形态的供应商就以目录为准，一路都没有时才轮到它们。按形态逐格顶替而不是
「目录一非空就全顶掉」——配了一路订阅账号不该把好端端的按量那一路挤没。
"""

from collections.abc import Callable
from dataclasses import dataclass

from ai_assistant.llm.adapters.codex_oauth import (
    CodexOAuthAdapter,
    build_catalog_codex,
    build_env_codex,
)
from ai_assistant.llm.adapters.endpoint import (
    build_env_endpoint,
    endpoint_on,
    timeout_of,
)
from ai_assistant.llm.codex.token_provider import TokenSource
from ai_assistant.llm.ports import (
    PROVIDER_KIND_CODEX_OAUTH,
    PROVIDER_KIND_OPENAI_COMPAT,
    PURPOSE_EMBEDDING,
    ModelAdapter,
    ModelKind,
)
from ai_assistant.settings import Settings
from llmcore import (
    MODEL_KIND_CHAT,
    CatalogSource,
    ChatEndpoint,
    DynamicEmbeddingAdapter,
    EmbeddingAdapter,
    EmbeddingEndpoint,
    ModelCatalog,
    OpenAiCompatAdapter,
    ProviderSpec,
)


@dataclass(frozen=True)
class AdapterDeps:
    """装一路来源要的那几样。

    ⚠ 打成一包而不是逐个形参：装配口子的形状要全部形态共用，而每多接一种
    东西（目录、凭据面）就要改每一路的签名。
    """

    settings: Settings
    # 订阅账号那一路的凭据面；没接就是 None
    tokens: TokenSource | None = None
    # 模型目录；没接就是 None（只有用例会这么装）
    catalog: CatalogSource | None = None


# 把目录里的一路供应商变成一个适配器。⚠ 接不上时给 `None` 而不是抛：
# 那一路就是没接，而整个服务在没接模型时仍然要能起、会话历史仍然要能读
ProviderAdapterBuilder = Callable[
    [ProviderSpec, AdapterDeps], ModelAdapter | None
]


def _endpoint(provider: ProviderSpec, deps: AdapterDeps) -> ModelAdapter:
    catalog = deps.catalog

    def resolve(kind: ModelKind) -> ChatEndpoint | None:
        # pragma 理由：只有装了目录才会走到这里，见 `build_adapters`
        if catalog is None:  # pragma: no cover
            return None
        return endpoint_on(provider, kind, catalog.snapshot(), deps.settings)

    return OpenAiCompatAdapter(
        resolve=resolve,
        label=provider.name,
        models=tuple(one.name for one in provider.models_of(MODEL_KIND_CHAT)),
        id=provider.id,
    )


def _codex(provider: ProviderSpec, deps: AdapterDeps) -> ModelAdapter | None:
    return build_catalog_codex(provider, deps.settings, deps.tokens)


# 形态 → 装配口子。⚠ 这张表就是「本服务接得了哪几种供应商」的全部答案
KIND_BUILDERS: dict[str, ProviderAdapterBuilder] = {
    PROVIDER_KIND_OPENAI_COMPAT: _endpoint,
    PROVIDER_KIND_CODEX_OAUTH: _codex,
}


def build_adapters(deps: AdapterDeps) -> tuple[ModelAdapter, ...]:
    """按此刻的目录装出接得上的那几路，保持目录序。

    Args: deps。
    """
    listed: list[ModelAdapter] = []
    covered: set[str] = set()
    for provider in _providers(deps.catalog):
        make = KIND_BUILDERS.get(provider.kind)
        if make is None:
            continue
        made = make(provider, deps)
        if made is None:
            continue
        listed.append(made)
        covered.add(provider.kind)
    listed.extend(_env_adapters(deps, covered))
    return tuple(listed)


def build_openai_embedding(deps: AdapterDeps) -> EmbeddingAdapter | None:
    """嵌入那一路。目录与环境变量都没接时给 `None`——本部署可以只记不查。

    ⚠ 它不是一个档位：返回的是向量不是对话模型，故不进 `build_adapters`
    那一串，也不出现在面板的下拉里。

    Args: deps。
    """
    if deps.catalog is None and deps.settings.embedding_endpoint() is None:
        return None
    catalog = deps.catalog
    return DynamicEmbeddingAdapter(
        resolve=lambda: resolve_embedding_endpoint(deps),
        refresh=None if catalog is None else catalog.refresh,
    )


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


def _providers(catalog: CatalogSource | None) -> tuple[ProviderSpec, ...]:
    """目录里此刻开着的那几路；没接目录时是空的。

    Args: catalog。
    """
    if catalog is None:
        return ()
    snapshot: ModelCatalog = catalog.snapshot()
    return snapshot.enabled_providers()


def _env_adapters(deps: AdapterDeps, covered: set[str]) -> list[ModelAdapter]:
    """环境变量配出来的那几路里，还没被目录顶替掉的。

    Args: deps, covered（目录里已经出现过的形态）。
    """
    listed: list[ModelAdapter] = []
    if PROVIDER_KIND_OPENAI_COMPAT not in covered:
        made = build_env_endpoint(deps.settings)
        if made is not None:
            listed.append(made)
    if PROVIDER_KIND_CODEX_OAUTH not in covered:
        codex = build_env_codex(deps.settings, deps.tokens)
        if codex is not None:
            listed.append(codex)
    return listed


__all__ = [
    "KIND_BUILDERS",
    "AdapterDeps",
    "CodexOAuthAdapter",
    "OpenAiCompatAdapter",
    "ProviderAdapterBuilder",
    "build_adapters",
    "build_openai_embedding",
    "resolve_embedding_endpoint",
    "timeout_of",
]
