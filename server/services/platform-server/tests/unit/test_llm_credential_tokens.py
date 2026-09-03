"""令牌包与库里那段密文之间的换算。

守两条：令牌**只以密文落库**，以及解不开时给 `None` 而不是抛——换过加密密钥的
部署会走到这条路上，那时正确的行为是「就当没登录过」，而不是让整条读路径 500。
"""

import datetime as dt

from lib.crypto import SecretCipher
from platform_server.apps.llm_providers.services.tokens import TokenBundle

CIPHER = SecretCipher("t" * 32, label="test")
OTHER = SecretCipher("z" * 32, label="test")


def _bundle(**overrides: object) -> TokenBundle:
    base: dict[str, object] = {
        "access_token": "at-1",
        "refresh_token": "rt-1",
        "expires_at": dt.datetime.now(dt.UTC) + dt.timedelta(hours=1),
        "id_token": "id-1",
        "account_id": "acc-1",
        "plan_type": "plus",
    }
    base.update(overrides)
    return TokenBundle(
        **base
    )  # pyright: ignore[reportArgumentType]  # 理由：用例造件按名传参


def test_a_bundle_survives_a_round_trip() -> None:
    back = TokenBundle.from_cipher_text(
        _bundle().to_cipher_text(CIPHER), CIPHER
    )
    assert back is not None
    assert back.access_token == "at-1"
    assert back.refresh_token == "rt-1"
    assert back.plan_type == "plus"


def test_the_cipher_text_carries_no_token_in_the_clear() -> None:
    # 密文里能看见令牌的话，落库这件事就白做了
    assert "at-1" not in _bundle().to_cipher_text(CIPHER)


def test_a_bundle_from_another_key_reads_as_absent() -> None:
    # 换过密钥的部署走这条路：界面上是「没登录过」，不是一条 500
    assert (
        TokenBundle.from_cipher_text(_bundle().to_cipher_text(OTHER), CIPHER)
        is None
    )


def test_a_garbled_cipher_text_reads_as_absent() -> None:
    assert TokenBundle.from_cipher_text("不是密文", CIPHER) is None


def test_a_bundle_missing_a_token_reads_as_absent() -> None:
    text = CIPHER.encrypt('{"access_token": "at-1"}')
    assert TokenBundle.from_cipher_text(text, CIPHER) is None


def test_a_token_within_the_skew_counts_as_stale() -> None:
    soon = _bundle(expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(minutes=2))
    # 正好卡在边界上换的话，一次长回答会在中途拿着过期令牌撞 401
    assert soon.is_stale(skew_s=300)
    assert not soon.is_stale(skew_s=0)


def test_a_fresh_token_is_not_stale() -> None:
    assert not _bundle().is_stale(skew_s=300)


def test_a_cipher_text_that_is_not_json_reads_as_absent() -> None:
    assert (
        TokenBundle.from_cipher_text(CIPHER.encrypt("不是 JSON"), CIPHER)
        is None
    )


def test_a_cipher_text_holding_a_list_reads_as_absent() -> None:
    assert (
        TokenBundle.from_cipher_text(CIPHER.encrypt("[1, 2]"), CIPHER) is None
    )
