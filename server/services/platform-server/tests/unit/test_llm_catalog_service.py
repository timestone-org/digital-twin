"""给消费方下发的目录：密钥就地解开、解不开的那一路整路不下发、摘要不含密钥。

守的是「换过加密密钥」那条路：一行解不开的旧数据不许让整份目录 500，也不许
下发一个空密钥——那会让消费方每次调用撞 401，而那一档刻意不打开断路器。
"""

import uuid

from lib.crypto import SecretCipher
from platform_server.apps.llm_providers.enums import (
    PROVIDER_KIND_CODEX_OAUTH,
    PROVIDER_KIND_OPENAI_COMPAT,
)
from platform_server.apps.llm_providers.models import LlmProvider
from platform_server.apps.llm_providers.services.catalog_service import (
    CatalogAssignmentOut,
    _provider_out,
    _version,
)
from platform_server.apps.llm_providers.services.provider_service import (
    key_hint,
    models_of,
)

CIPHER = SecretCipher("llm-provider-secret-0123456789abcdef", label="t")
OTHER = SecretCipher("another-secret-value-0123456789abcdef", label="t")


def _row(
    *, api_key: str = "sk-secret", cipher: SecretCipher = CIPHER
) -> LlmProvider:
    return LlmProvider(
        id=uuid.UUID("3fa85f64-5717-4562-b3fc-2c963f66afa6"),
        name="百炼",
        kind=PROVIDER_KIND_OPENAI_COMPAT,
        base_url="https://endpoint/v1",
        api_key_enc=cipher.encrypt(api_key),
        api_key_hint=key_hint(api_key),
        is_enabled=True,
        extra_body_json={"enable_thinking": True},
        models_json=[
            {"name": "chat-1", "kind": "chat", "has_vision": True},
            {
                "name": "embed-1",
                "kind": "embedding",
                "has_vision": False,
                "dimensions": 1024,
            },
            "not a model",
        ],
        notes="",
    )


def test_the_catalog_carries_the_decrypted_key_and_the_models() -> None:
    out = _provider_out(_row(), CIPHER)
    assert out is not None
    assert out.api_key == "sk-secret"
    assert out.extra_body == {"enable_thinking": True}
    assert [one.name for one in out.models] == ["chat-1", "embed-1"]
    assert out.models[1].dimensions == 1024


def test_an_undecryptable_key_drops_the_whole_provider() -> None:
    """⚠ 下发空密钥比不下发更坏：消费方每次都撞 401，而那一档不开断路器。"""
    assert _provider_out(_row(cipher=OTHER), CIPHER) is None


def test_the_version_ignores_the_secret_but_not_the_assignment() -> None:
    one = _provider_out(_row(api_key="k1"), CIPHER)
    other = _provider_out(_row(api_key="k2"), CIPHER)
    assert one is not None
    assert other is not None
    assert _version([one], []) == _version([other], [])
    assigned = CatalogAssignmentOut(
        purpose="assistant.chat", provider_id=one.id, model_name="chat-1"
    )
    assert _version([one], [assigned]) != _version([one], [])


def test_malformed_model_rows_are_skipped_not_fatal() -> None:
    names = [one.name for one in models_of(_row())]
    assert names == ["chat-1", "embed-1"]


def test_the_key_hint_shows_only_a_tail() -> None:
    assert key_hint("sk-1234567890") == "…7890"
    # 本来就短的密钥连尾巴都不露：露了等于露了整把
    assert key_hint("abc") == "…***"


def test_a_login_based_provider_ships_without_a_key() -> None:
    """⚠ 没有密钥的形态不是「解不开」：整路照常下发，能不能用由消费方那一侧
    的登录态回答。判成解不开的话，配好的那一路在界面上是「已启用」而助手
    永远看不见它。"""
    row = LlmProvider(
        id=uuid.UUID("3fa85f64-5717-4562-b3fc-2c963f66afa7"),
        name="Codex",
        kind=PROVIDER_KIND_CODEX_OAUTH,
        base_url=None,
        api_key_enc=None,
        api_key_hint="",
        is_enabled=True,
        options_json={"default_effort": "high"},
        models_json=[{"name": "gpt-5-codex", "kind": "chat"}],
        notes="",
    )
    out = _provider_out(row, CIPHER)
    assert out is not None
    assert out.kind == PROVIDER_KIND_CODEX_OAUTH
    assert out.api_key == ""
    assert out.base_url == ""
    assert out.options == {"default_effort": "high"}


def test_the_version_changes_with_the_kind() -> None:
    """⚠ 形态进摘要：不进的话，改了形态的那一份目录看着与旧的一模一样。"""
    plain = _provider_out(_row(), CIPHER)
    assert plain is not None
    switched = plain.model_copy(update={"kind": PROVIDER_KIND_CODEX_OAUTH})
    assert _version([plain], []) != _version([switched], [])
