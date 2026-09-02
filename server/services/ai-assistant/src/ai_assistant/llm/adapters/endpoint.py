"""端点那一形态：一个 OpenAI 兼容地址 + 一把密钥。

目录里配出来的那几路与环境变量里配的那一路都走这里，出去的都是同一个
`OpenAiCompatAdapter`——两处各造一种适配器的话，「按量那一路」的行为就会随
它是从哪儿配来的而不同，而那种差异只会在某一次调用上冒出来。

⚠ 一路之内**逐档挑模型**：用途分配指到本路时用它指的那个，否则用本路上第一个
吃得下这一档的。看图那一档还要模型自己接图——挑一个不接图的模型去接图片块，
它多半只回一句「我没看到图」，而调用照样成功、照样计费。
"""

from ai_assistant.llm.ports import (
    DEFAULT_PROFILE,
    PURPOSE_OF_KIND,
    ModelKind,
)
from ai_assistant.settings import Settings
from llmcore import (
    MODEL_KIND_CHAT,
    ChatEndpoint,
    ModelCatalog,
    ModelSpec,
    OpenAiCompatAdapter,
    ProviderSpec,
)


def timeout_of(settings: Settings, kind: ModelKind) -> float:
    """这一档的调用预算：看图那一档单配，别的档共用对话档的。

    Args: settings, kind。
    """
    if kind == "vision" and settings.vision_timeout_s is not None:
        return settings.vision_timeout_s
    return settings.model_timeout_s


def model_for(
    provider: ProviderSpec, kind: ModelKind, catalog: ModelCatalog
) -> ModelSpec | None:
    """这一路上吃这一档的那个模型；没有给 `None`。

    Args: provider, kind, catalog（此刻的目录快照，用来读用途分配）。
    """
    assigned = catalog.assigned(PURPOSE_OF_KIND[kind])
    if assigned is not None and assigned.provider_id == provider.id:
        named = provider.model_named(assigned.model_name)
        if named is not None and _fits(named, kind):
            return named
    return next(
        (
            one
            for one in provider.models_of(MODEL_KIND_CHAT)
            if _fits(one, kind)
        ),
        None,
    )


def endpoint_on(
    provider: ProviderSpec,
    kind: ModelKind,
    catalog: ModelCatalog,
    settings: Settings,
) -> ChatEndpoint | None:
    """这一路的这一档要打的端点；这一档吃不下时给 `None`。

    Args: provider, kind, catalog, settings。
    """
    model = model_for(provider, kind, catalog)
    if model is None:
        return None
    return catalog.endpoint_on(
        provider, model, timeout_s=timeout_of(settings, kind)
    )


def build_env_endpoint(settings: Settings) -> OpenAiCompatAdapter | None:
    """环境变量配出来的那一路。没配就是 `None`——这一路就是没接。

    ⚠ 它是目录的**永久默认值**（config-and-secrets §7.1），不是一次性播种：
    目录里一路端点型供应商都没有时才轮到它。

    Args: settings。
    """
    if settings.endpoint_of("chat") is None:
        return None
    return OpenAiCompatAdapter(
        resolve=settings.endpoint_of,
        label="按量计费端点",
        models=(settings.model_chat,),
        id=DEFAULT_PROFILE,
    )


def _fits(model: ModelSpec, kind: ModelKind) -> bool:
    """这个模型吃不吃得下这一档。

    Args: model, kind。
    """
    if model.kind != MODEL_KIND_CHAT:
        return False
    return kind != "vision" or model.has_vision
