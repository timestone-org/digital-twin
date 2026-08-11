"""锁住令牌校验的拒绝路径：算法混淆、签名不符、类型不符、过期、密钥轮换。"""

from datetime import timedelta

import jwt as pyjwt
import pytest

from lib.auth import JwtCodec, TokenError
from lib.utils.timeutils import utcnow

SECRET = "unit-test-secret-0123456789abcdef-extra-bytes"
OTHER = "unit-test-other-0123456789abcdef-extra-bytes"
# ⚠ pyjwt 的过期判定读的是真实时钟，签发时刻只能注入、校验时刻不能。
# 正例因此必须用「此刻 + 长有效期」，反例才用固定的过去时刻。
NOW = utcnow()
LONG_TTL_S = 3600


def make_codec(*, previous: str | None = None) -> JwtCodec:
    keys = (SECRET,) if previous is None else (SECRET, previous)
    return JwtCodec(signing_key=SECRET, verification_keys=keys, issuer="auth")


def test_issued_token_decodes_back_to_its_claims() -> None:
    codec = make_codec()
    token, claims = codec.issue(
        subject="u1", token_type="access", ttl_s=LONG_TTL_S, now=NOW
    )
    decoded = codec.decode(token, expected_type="access")
    assert decoded.subject == "u1"
    assert decoded.token_id == claims.token_id
    assert decoded.expires_at == (NOW + timedelta(seconds=LONG_TTL_S)).replace(
        microsecond=0
    )


def test_token_signed_with_another_key_is_rejected() -> None:
    foreign = JwtCodec(
        signing_key=OTHER, verification_keys=(OTHER,), issuer="auth"
    )
    token, _ = foreign.issue(
        subject="u1", token_type="access", ttl_s=LONG_TTL_S, now=NOW
    )
    with pytest.raises(TokenError):
        make_codec().decode(token, expected_type="access")


def test_alg_none_token_is_rejected() -> None:
    payload = {
        "sub": "u1",
        "jti": "j1",
        "typ": "access",
        "iss": "auth",
        "iat": int(NOW.timestamp()),
        "exp": int((NOW + timedelta(hours=1)).timestamp()),
    }
    forged = pyjwt.encode(payload, key="", algorithm="none")
    with pytest.raises(TokenError):
        make_codec().decode(forged, expected_type="access")


def test_refresh_token_is_not_accepted_as_access_token() -> None:
    codec = make_codec()
    token, _ = codec.issue(
        subject="u1", token_type="refresh", ttl_s=LONG_TTL_S, now=NOW
    )
    with pytest.raises(TokenError):
        codec.decode(token, expected_type="access")


def test_expired_token_is_rejected() -> None:
    codec = make_codec()
    stale = NOW - timedelta(hours=2)
    token, _ = codec.issue(
        subject="u1", token_type="access", ttl_s=60, now=stale
    )
    with pytest.raises(TokenError):
        codec.decode(token, expected_type="access")


def test_token_from_previous_key_still_verifies_during_rotation() -> None:
    old = JwtCodec(signing_key=OTHER, verification_keys=(OTHER,), issuer="auth")
    token, _ = old.issue(
        subject="u1", token_type="access", ttl_s=LONG_TTL_S, now=NOW
    )
    rotated = make_codec(previous=OTHER)
    assert rotated.decode(token, expected_type="access").subject == "u1"


def test_token_from_another_issuer_is_rejected() -> None:
    foreign = JwtCodec(
        signing_key=SECRET, verification_keys=(SECRET,), issuer="other"
    )
    token, _ = foreign.issue(
        subject="u1", token_type="access", ttl_s=LONG_TTL_S, now=NOW
    )
    with pytest.raises(TokenError):
        make_codec().decode(token, expected_type="access")


def test_token_missing_required_claim_is_rejected() -> None:
    incomplete = pyjwt.encode(
        {
            "sub": "u1",
            "typ": "access",
            "iss": "auth",
            "iat": int(NOW.timestamp()),
            "exp": int((NOW + timedelta(hours=1)).timestamp()),
        },
        SECRET,
        algorithm="HS256",
    )
    with pytest.raises(TokenError):
        make_codec().decode(incomplete, expected_type="access")


def test_extra_claims_survive_the_roundtrip() -> None:
    codec = make_codec()
    token, _ = codec.issue(
        subject="u1",
        token_type="access",
        ttl_s=LONG_TTL_S,
        extra={"tenant": "t1"},
        now=NOW,
    )
    assert codec.decode(token, expected_type="access").extra == {"tenant": "t1"}
