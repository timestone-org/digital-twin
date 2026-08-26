"""一份订阅账号的令牌包，以及它与库里那一行密文之间的换算。

⚠ 这是本模块自己的形状，不是上游库那个私有 dataclass。两者在
`llm/codex` 那一层换算——把私有 API 的接触面收在一个文件里，
上游改名时红的是那一处，而不是整条链路。
"""

import datetime as dt
import json
from dataclasses import dataclass
from typing import Any, Self, cast

from lib.crypto import SecretCipher

# id_token 里那几格自定义声明挂在这个命名空间下
CLAIMS_NAMESPACE = "https://api.openai.com/auth"


@dataclass(frozen=True)
class TokenBundle:
    """一次登录换回来的全部东西。

    ⚠ 三个令牌都是**口令等价物**：不进日志、不进响应、不进错误信息。
    """

    access_token: str
    refresh_token: str
    expires_at: dt.datetime
    id_token: str | None = None
    account_id: str | None = None
    plan_type: str | None = None

    def is_stale(self, *, skew_s: int) -> bool:
        """过期了，或者快过期了。

        Args: skew_s（提前多少秒就算该换了）。
        """
        now = dt.datetime.now(dt.UTC)
        return now >= self.expires_at - dt.timedelta(seconds=skew_s)

    def to_cipher_text(self, cipher: SecretCipher) -> str:
        """整包加密成一段密文。

        Args: cipher。
        """
        body = {
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "expires_at": self.expires_at.isoformat(),
            "id_token": self.id_token,
            "account_id": self.account_id,
            "plan_type": self.plan_type,
        }
        return cipher.encrypt(json.dumps(body, ensure_ascii=False))

    @classmethod
    def from_cipher_text(
        cls, token_enc: str, cipher: SecretCipher
    ) -> Self | None:
        """密文解回一份令牌包；解不开或缺字段给 `None`。

        ⚠ 解不开不是异常：换过加密密钥的部署会走到这里，而那时正确的行为是
        「就当没登录过」，由界面提示重新登录——抛出去的话，一行解不开的旧数据
        会让整条读路径 500。

        Args: token_enc, cipher。
        """
        plain = cipher.decrypt(token_enc)
        if plain is None:
            return None
        try:
            body: Any = json.loads(plain)
        except ValueError:
            return None
        return cls._from_body(body)

    @classmethod
    def _from_body(cls, body: object) -> Self | None:
        if not isinstance(body, dict):
            return None
        fields = cast("dict[str, Any]", body)
        access = fields.get("access_token")
        refresh = fields.get("refresh_token")
        expires = fields.get("expires_at")
        if not (
            isinstance(access, str)
            and isinstance(refresh, str)
            and isinstance(expires, str)
        ):
            return None
        return cls(
            access_token=access,
            refresh_token=refresh,
            expires_at=dt.datetime.fromisoformat(expires),
            id_token=_text_or_none(fields.get("id_token")),
            account_id=_text_or_none(fields.get("account_id")),
            plan_type=_text_or_none(fields.get("plan_type")),
        )


def _text_or_none(given: object) -> str | None:
    return given if isinstance(given, str) and given else None
