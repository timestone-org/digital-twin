"""模型供应商面的出入参。"""

from platform_server.apps.llm_providers.schemas.credential import (
    LlmCredentialOut,
    LlmCredentialTokenOut,
    LlmDeviceLoginPollIn,
    LlmDeviceLoginPollOut,
    LlmDeviceLoginStartOut,
)
from platform_server.apps.llm_providers.schemas.provider import (
    MAX_MODELS_PER_PROVIDER,
    LlmAssignmentIn,
    LlmModelIn,
    LlmModelOut,
    LlmProbeIn,
    LlmProbeOut,
    LlmProviderIn,
    LlmProviderKindOut,
    LlmProviderOut,
    LlmProviderPresetOut,
    LlmProviderUpdateIn,
    LlmPurposeOut,
    LlmRerankDialectOut,
)

__all__ = [
    "MAX_MODELS_PER_PROVIDER",
    "LlmAssignmentIn",
    "LlmCredentialOut",
    "LlmCredentialTokenOut",
    "LlmDeviceLoginPollIn",
    "LlmDeviceLoginPollOut",
    "LlmDeviceLoginStartOut",
    "LlmModelIn",
    "LlmModelOut",
    "LlmProbeIn",
    "LlmProbeOut",
    "LlmProviderIn",
    "LlmProviderKindOut",
    "LlmProviderOut",
    "LlmProviderPresetOut",
    "LlmProviderUpdateIn",
    "LlmPurposeOut",
    "LlmRerankDialectOut",
]
