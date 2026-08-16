"""数据源口令的加解密：Fernet 对称加密，密钥由服务配置派生。

⚠ 解不开（换过密钥，或库里还是一期的 "configured" 占位符）给 None 而不是抛：
计划构建要在这条路上活下去——按未配置凭据下发并响亮记日志，采集器按匿名连接、
连不上会以 auth 类错误暴露出来，用户重填一次口令即可恢复。
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from lib.logging import get_logger

_logger = get_logger("platform.collect.credentials")


class CredentialCipher:
    """一把口令加解密器。进程内构造一次，随依赖注入传给写路径与计划构建。"""

    def __init__(self, secret: str) -> None:
        """由服务配置的密钥串派生 Fernet 密钥。

        Args: secret（`PLATFORM_COLLECT_CREDENTIAL_SECRET`，≥32 字符）。
        """
        digest = hashlib.sha256(secret.encode("utf-8")).digest()
        self._fernet = Fernet(base64.urlsafe_b64encode(digest))

    def encrypt(self, plaintext: str) -> str:
        """口令明文 → 密文（进 `credential_enc` 列）。

        Args: plaintext。
        """
        return self._fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")

    def decrypt(self, token: str) -> str | None:
        """密文 → 明文；解不开给 None 并响亮记日志。

        Args: token。
        """
        try:
            return self._fernet.decrypt(token.encode("ascii")).decode("utf-8")
        except (InvalidToken, ValueError):
            _logger.error(
                "collect_credential_undecryptable",
                "凭据密文解不开（换过密钥或是一期占位行），按未配置下发",
            )
            return None
