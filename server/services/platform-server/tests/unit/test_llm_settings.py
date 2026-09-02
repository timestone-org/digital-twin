"""目录密钥的长度校验：配了就得够长，没配即目录没开。"""

import pytest
from pydantic import SecretStr, ValidationError

from platform_server.settings import LLM_PROVIDER_SECRET_MIN_LENGTH, Settings
from unit.wiring_fakes import build_settings


def _with_secret(secret: SecretStr | None) -> Settings:
    """同一份能构造的配置，只换目录密钥。

    Args: secret。
    """
    fields = build_settings().model_dump()
    fields["llm_provider_secret"] = secret
    return Settings(**fields)


def test_the_secret_may_be_absent_which_means_the_catalog_is_off() -> None:
    assert _with_secret(None).llm_provider_secret is None


def test_a_secret_of_the_minimum_length_is_kept() -> None:
    given = SecretStr("k" * LLM_PROVIDER_SECRET_MIN_LENGTH)
    assert _with_secret(given).llm_provider_secret == given


def test_a_short_secret_is_rejected_at_startup() -> None:
    short = SecretStr("k" * (LLM_PROVIDER_SECRET_MIN_LENGTH - 1))
    with pytest.raises(ValidationError, match="PLATFORM_LLM_PROVIDER_SECRET"):
        _with_secret(short)
