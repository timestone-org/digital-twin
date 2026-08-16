"""口令加解密器：能往返、解不开给 None 而不是抛。

⚠ 「解不开」不是边角：一期的库里存的是 "configured" 占位符，换密钥也会走到
这条路。抛出去的话整个计划端点 500，采集器一台设备都连不上。
"""

from platform_server.apps.collect.services.credentials import CredentialCipher

SECRET = "unit-test-credential-secret-0123456789"


def test_a_password_round_trips() -> None:
    cipher = CredentialCipher(SECRET)
    token = cipher.encrypt("s3cr3t-p@ss")
    assert token != "s3cr3t-p@ss"
    assert cipher.decrypt(token) == "s3cr3t-p@ss"


def test_the_legacy_placeholder_reads_as_none() -> None:
    # 一期存的占位符不是合法密文，必须安静地按「未配置」处理
    assert CredentialCipher(SECRET).decrypt("configured") is None


def test_a_foreign_key_cannot_read_the_token() -> None:
    token = CredentialCipher(SECRET).encrypt("s3cr3t-p@ss")
    other = CredentialCipher("another-credential-secret-0123456789ab")
    assert other.decrypt(token) is None


def test_two_ciphers_with_the_same_secret_interoperate() -> None:
    # 三个 API 副本各自派生密钥：同一密钥必须解得开彼此的密文
    token = CredentialCipher(SECRET).encrypt("s3cr3t-p@ss")
    assert CredentialCipher(SECRET).decrypt(token) == "s3cr3t-p@ss"
