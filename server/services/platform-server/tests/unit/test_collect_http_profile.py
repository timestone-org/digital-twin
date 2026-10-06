"""HTTP 完整配置的静态校验与秘密字段边界。"""

import pytest

from platform_server.apps.collect.errors import PointInvalid, SourceInvalid
from platform_server.apps.collect.models import CollectSource
from platform_server.apps.collect.services.credentials import CredentialCipher
from platform_server.apps.collect.services.http_profile import (
    validate_http_address,
    validate_http_source,
)


@pytest.fixture
def cipher() -> CredentialCipher:
    return CredentialCipher("unit-test-http-profile-key-0123456789")


def source_profile(
    cipher: CredentialCipher,
    auth_type: str,
    username: str | None = None,
    secret: str | None = None,
) -> CollectSource:
    """一个尚未持久化的 HTTP 源。Args: cipher, auth_type, username, secret。"""
    return CollectSource(
        protocol="http",
        endpoint="https://api.example.test/readings",
        read_mode="poll",
        poll_interval_ms=1000,
        options_json={"auth_type": auth_type},
        username=username,
        credential_enc=None if secret is None else cipher.encrypt(secret),
    )


@pytest.mark.parametrize(
    ("auth_type", "username", "secret"),
    [
        ("none", "reader", None),
        ("none", None, "secret"),
        ("basic", " ", "secret"),
        ("digest", None, "secret"),
        ("bearer", None, ""),
        ("api_key", None, "  "),
        ("bearer", "reader", "secret"),
        ("bearer", None, "line\nbreak"),
        ("api_key", None, "密钥"),
    ],
    ids=[
        "anonymous-user",
        "anonymous-secret",
        "blank-user",
        "digest-user",
        "empty-token",
        "blank-token",
        "unexpected-user",
        "header-newline",
        "header-unicode",
    ],
)
def test_invalid_auth_profiles_are_rejected_without_secret_echo(
    cipher: CredentialCipher,
    auth_type: str,
    username: str | None,
    secret: str | None,
) -> None:
    with pytest.raises(SourceInvalid) as captured:
        validate_http_source(
            source_profile(cipher, auth_type, username, secret), cipher
        )
    if secret and secret.strip():
        assert secret not in str(captured.value)


def test_an_undecryptable_secret_cannot_pass_http_auth_validation(
    cipher: CredentialCipher,
) -> None:
    source = source_profile(cipher, "bearer")
    source.credential_enc = "not-a-fernet-token"
    with pytest.raises(SourceInvalid, match="有效凭据"):
        validate_http_source(source, cipher)


def test_anonymous_http_accepts_the_default_request_options(
    cipher: CredentialCipher,
) -> None:
    source = source_profile(cipher, "none")
    source.options_json = {}
    assert validate_http_source(source, cipher) is None


def test_non_http_profiles_keep_their_protocol_options(
    cipher: CredentialCipher,
) -> None:
    source = source_profile(cipher, "none")
    source.protocol = "opcua"
    source.endpoint = "opc.tcp://127.0.0.1:4840"
    source.options_json = {"security_mode": "none"}
    assert validate_http_source(source, cipher) is None
    assert (
        validate_http_address("opcua", "ns=2;s=temperature", field="address")
        is None
    )


def test_pointer_rejection_identifies_the_original_input_field() -> None:
    with pytest.raises(PointInvalid) as captured:
        validate_http_address("http", "/data/~3key", field="items[2].address")
    assert captured.value.details[0].field == "items[2].address"
