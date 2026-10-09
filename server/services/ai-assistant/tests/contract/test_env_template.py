"""Windows 助手配置模板的数值超时兼容契约。"""

import os
from pathlib import Path

import pytest
from pydantic import SecretStr

from ai_assistant.settings import Settings


@pytest.mark.parametrize(
    "none_marker",
    ["null", "__numeric_only_loader__"],
    ids=["current-loader", "numeric-only-loader"],
)
def test_windows_template_uses_positive_numeric_timeouts(
    none_marker: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in tuple(os.environ):
        if name.startswith("ASSISTANT_"):
            monkeypatch.delenv(name)
    settings = Settings(
        _env_file=Path(__file__).resolve().parents[2] / ".env.example",
        _env_parse_none_str=none_marker,
        postgres_password=SecretStr("template-test"),
        edge_signing_secret=SecretStr("s" * 32),
        edge_service_key=SecretStr("k" * 32),
        redis_password=None,
        model_api_key=None,
        vision_api_key=None,
        embedding_api_key=None,
        mcp_tokens=None,
    )

    assert settings.vision_timeout_s is not None
    assert settings.embedding_timeout_s is not None
    assert settings.vision_timeout_s > 0
    assert settings.embedding_timeout_s > 0
