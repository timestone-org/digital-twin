"""模型封存与加载在反序列化之前执行同一体积预算。"""

import pytest

from platform_server.apps.modeling.services import artifact_store
from platform_server.apps.modeling.services.artifact_store import (
    ArtifactRejected,
)


def test_model_artifact_is_rejected_before_storage_when_too_large(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(artifact_store, "MAX_ARTIFACT_BYTES", 16)
    with pytest.raises(ArtifactRejected, match="超过 32 MB"):
        artifact_store.seal({"values": "synthetic" * 100})


def test_loading_rejects_over_budget_valid_digest_before_unpickling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sealed = artifact_store.seal({"values": "synthetic" * 100})
    monkeypatch.setattr(artifact_store, "MAX_ARTIFACT_BYTES", 16)
    with pytest.raises(ArtifactRejected, match="拒绝加载"):
        artifact_store.load(
            sealed.payload,
            digest=sealed.digest,
            format_version=sealed.format_version,
            runtime=sealed.runtime,
        )
