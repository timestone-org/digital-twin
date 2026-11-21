"""锁住签名头编解码的三条契约：空集非空编码、任意 Unicode 可进 latin-1 头、
非法输入一律 fail-closed。这三条错了都是静默的安全洞。
"""

from dataclasses import replace

import pytest

from lib.auth import header_codec as codec


def test_empty_permission_set_encodes_to_non_empty_string() -> None:
    assert codec.encode_permissions([]) == "W10"


def test_permission_roundtrip_is_order_independent() -> None:
    encoded = codec.encode_permissions(["b:x", "a:y", "b:x"])
    assert codec.decode_permissions(encoded) == frozenset({"a:y", "b:x"})


def test_encoded_permissions_use_only_url_safe_alphabet() -> None:
    encoded = codec.encode_permissions(["中文:码", "a/b+c=d"])
    assert set(encoded) <= set(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ" "abcdefghijklmnopqrstuvwxyz0123456789-_"
    )


@pytest.mark.parametrize(
    "raw",
    ["", None, "!!!not-base64!!!", "eyJhIjoxfQ", "W251bGxd"],
    ids=["empty", "none", "not-base64", "not-a-list", "list-of-null"],
)
def test_malformed_permission_header_yields_empty_set(
    raw: str | None,
) -> None:
    assert codec.decode_permissions(raw) == frozenset()


def test_ascii_identity_encoding_is_identity() -> None:
    assert codec.encode_identity("admin") == "admin"


def test_non_ascii_identity_survives_latin1_header_encoding() -> None:
    encoded = codec.encode_identity("张三")
    assert encoded == "%E5%BC%A0%E4%B8%89"
    encoded.encode("latin-1")
    assert codec.decode_identity(encoded) == "张三"


def context(**overrides: str | int) -> codec.SignedContext:
    fields: dict[str, str | int] = {
        "user_id": "u1",
        "role": "admin",
        "permissions_b64": "W10",
        "expires_at": 2000,
    }
    fields.update(overrides)
    return codec.SignedContext(**fields)  # type: ignore[arg-type]  # 测试夹具按名传值，类型由 SignedContext 自己收敛


def test_signature_verifies_only_with_matching_fields() -> None:
    signed = context(permissions_b64=codec.encode_permissions(["a"]))
    signature = codec.sign_context("secret", signed)
    assert codec.verify_context("secret", signed, signature=signature, now=1000)
    tampered = context(
        permissions_b64=codec.encode_permissions(["a"]), role="viewer"
    )
    assert not codec.verify_context(
        "secret", tampered, signature=signature, now=1000
    )


def test_expired_signature_is_rejected() -> None:
    signed = context()
    signature = codec.sign_context("secret", signed)
    assert not codec.verify_context(
        "secret", signed, signature=signature, now=2000
    )


def test_missing_secret_or_signature_fails_closed() -> None:
    signed = context()
    assert not codec.verify_context("", signed, signature="x", now=1)
    assert not codec.verify_context("s", signed, signature="", now=1)


def test_named_signature_binds_all_legitimate_account_claims() -> None:
    account = codec.SignedContext(
        user_id="00000000-0000-7000-8000-000000000001",
        role=codec.encode_identity("读者"),
        permissions_b64=codec.encode_permissions(["assets:view"]),
        expires_at=1999999999,
    )
    username = codec.encode_identity("本地验收员")
    before = codec.sign_named_context("unit-test", account, username)
    claims = [
        (
            replace(account, user_id="00000000-0000-7000-8000-000000000002"),
            username,
        ),
        (replace(account, role=codec.encode_identity("维护员")), username),
        (
            replace(account, permissions_b64=codec.encode_permissions([])),
            username,
        ),
        (replace(account, expires_at=account.expires_at + 1), username),
        (account, codec.encode_identity("本地新名字")),
    ]
    assert (
        len(
            {
                before,
                *(
                    codec.sign_named_context("unit-test", updated, name)
                    for updated, name in claims
                ),
            }
        )
        == len(claims) + 1
    )
    assert codec.sign_named_context("unit-test", account, username) == before
    assert before != codec.sign_context("unit-test", account)
