"""对外面的 API 密钥：铸一把、算摘要、比对。纯计算，不碰库。

⚠ 明文只在铸出来那一刻存在，之后**只有摘要**进得了库。想「找回密钥」这件事
在设计上就做不到——做得到就意味着存在一个能读出全部密钥的接口
（docs/MODELING_PLATFORM_DESIGN.md D13）。
⚠ 明文是高熵随机串不是口令：不需要慢哈希（那防的是字典攻击，这里没有字典），
但比对**必须**用 `compare_digest`——普通 `==` 逐字节短路，比对耗时会泄漏前缀。
"""

import hashlib
import hmac
import secrets
from dataclasses import dataclass

# 明文的固定前缀。⚠ 有它才能在日志、代码库、告警里一眼认出「这是一把密钥」，
# 而各家扫描器也按前缀识别泄漏
KEY_NAMESPACE = "dtmk"
# 随机段的字节数。32 字节 → 43 位 base64url，熵远超暴力破解的门槛
KEY_ENTROPY_BYTES = 32
# 明文里可见并落库的前几位，用于在列表里认出是哪一把
KEY_PREFIX_LENGTH = 12


@dataclass(frozen=True)
class MintedKey:
    """刚铸出来的一把钥匙。`plaintext` 只在这一刻存在。"""

    plaintext: str
    prefix: str
    digest: str


def mint() -> MintedKey:
    """铸一把新钥匙。"""
    plaintext = f"{KEY_NAMESPACE}_{secrets.token_urlsafe(KEY_ENTROPY_BYTES)}"
    return MintedKey(
        plaintext=plaintext,
        prefix=plaintext[:KEY_PREFIX_LENGTH],
        digest=digest_of(plaintext),
    )


def digest_of(plaintext: str) -> str:
    """明文的 sha256，十六进制。

    Args: plaintext。
    """
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def matches(plaintext: str, digest: str) -> bool:
    """明文对不对得上摘要。

    ⚠ `compare_digest` 不能换成 `==`：后者逐字节短路，比对耗时会泄漏前缀。
    Args: plaintext, digest。
    """
    return hmac.compare_digest(digest_of(plaintext), digest)


def looks_like_a_key(value: str) -> bool:
    """长得像不像一把本系统的钥匙。

    ⚠ 只用来**尽早**挡掉明显不是的输入，省一次查库；不是鉴权判据——鉴权只认
    摘要对不对得上。
    Args: value。
    """
    return value.startswith(f"{KEY_NAMESPACE}_") and len(value) > (
        KEY_PREFIX_LENGTH
    )
