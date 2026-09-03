"""接入形态清单摊成出参。

⚠ 前端按这一份渲染表单、后端按同一份校验（`rules.py`）：两份漂开的表现是
「表单里填了、保存时 422」，而报出来的那句话指不回是哪一格多余。
"""

from platform_server.apps.llm_providers.enums import (
    PROVIDER_KINDS,
    ProviderKindSpec,
)
from platform_server.apps.llm_providers.schemas import (
    LlmProviderKindOut,
    LlmProviderPresetOut,
    LlmRerankDialectOut,
)


def kind_out(spec: ProviderKindSpec) -> LlmProviderKindOut:
    """一种形态摊成出参。

    Args: spec。
    """
    return LlmProviderKindOut(
        code=spec.code,
        label=spec.label,
        description=spec.description,
        is_endpoint_required=spec.is_endpoint_required,
        is_login_required=spec.is_login_required,
        model_kinds=list(spec.model_kinds),
        consumers=list(spec.consumers),
        efforts=list(spec.efforts),
        rerank_dialects=[
            LlmRerankDialectOut(
                code=one.code, label=one.label, description=one.description
            )
            for one in spec.rerank_dialects
        ],
        presets=[
            LlmProviderPresetOut(
                code=one.code, label=one.label, base_url=one.base_url
            )
            for one in spec.presets
        ],
    )


def list_kinds() -> list[LlmProviderKindOut]:
    """接得了哪几种供应商，按目录顺序。"""
    return [kind_out(one) for one in PROVIDER_KINDS]
