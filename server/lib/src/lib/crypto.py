"""对称加解密：把要落库的密文串加解出来。

⚠ 解不开时给 `None` 而不是抛。密钥轮换过、或者库里那一行是更早的占位符，
都会走到这条路上，而调用方要能按「这一份用不了」继续活下去——抛出去的话，
一行解不开的旧数据会让整条读路径 500。
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from lib.logging import get_logger

_logger = get_logger("lib.crypto")

# 密钥串的最短长度。⚠ 派生出来的 Fernet 密钥恒为 32 字节，所以短口令不会
# 在任何地方报错——它只是把熵降到能被穷举
MIN_SECRET_CHARS = 32


class SecretCipher:
    """一把对称加解密器。进程内构造一次，随依赖注入传给读写两侧。"""

    def __init__(self, secret: str, *, label: str) -> None:
        """由配置里的密钥串派生 Fernet 密钥。

        Args: secret（≥32 字符）, label（解不开时记进日志的用途名）。
        """
        if len(secret) < MIN_SECRET_CHARS:
            raise ValueError(f"密钥串至少 {MIN_SECRET_CHARS} 个字符")
        digest = hashlib.sha256(secret.encode("utf-8")).digest()
        self._fernet = Fernet(base64.urlsafe_b64encode(digest))
        self._label = label

    def encrypt(self, plaintext: str) -> str:
        """明文 → 密文。

        Args: plaintext。
        """
        return self._fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")

    def decrypt(self, token: str) -> str | None:
        """密文 → 明文；解不开给 `None` 并响亮记日志。

        Args: token。
        """
        try:
            return self._fernet.decrypt(token.encode("ascii")).decode("utf-8")
        except (InvalidToken, ValueError):
            _logger.error(
                "secret_undecryptable",
                "密文解不开（换过密钥或是更早的占位行），按未配置处理",
                label=self._label,
            )
            return None
