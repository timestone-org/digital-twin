"""JWT 签发与校验（纯算法）。

签发只用主密钥，校验遍历密钥集——否则一次密钥轮换就是一次全站强制重新登录
（见 docs/agents/config-and-secrets.md §5.2）。
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from lib.utils.timeutils import utcnow

ALGORITHM = "HS256"


class TokenError(Exception):
    """令牌不可用：签名不符、已过期、类型不符、载荷缺字段。"""


@dataclass(frozen=True)
class TokenClaims:
    """一枚令牌解出来的载荷。"""

    subject: str
    token_id: str
    token_type: str
    issued_at: datetime
    expires_at: datetime
    extra: Mapping[str, Any]


@dataclass(frozen=True)
class JwtCodec:
    """令牌编解码器。`issuer` 与密钥由调用方注入。"""

    signing_key: str
    verification_keys: tuple[str, ...]
    issuer: str

    def issue(
        self,
        *,
        subject: str,
        token_type: str,
        ttl_s: int,
        extra: Mapping[str, Any] | None = None,
        now: datetime | None = None,
    ) -> tuple[str, TokenClaims]:
        """签发一枚令牌，返回串与它的载荷。

        Args: subject, token_type, ttl_s, extra, now（测试注入时钟）。
        """
        issued_at = now or utcnow()
        expires_at = issued_at + timedelta(seconds=ttl_s)
        token_id = str(uuid.uuid4())
        payload: dict[str, Any] = {
            **(dict(extra) if extra else {}),
            "sub": subject,
            "jti": token_id,
            "typ": token_type,
            "iss": self.issuer,
            "iat": int(issued_at.timestamp()),
            "exp": int(expires_at.timestamp()),
        }
        # pyright: ignore 的理由 —— pyjwt 的 key 形参标成 Unknown，上游无标注
        encoded: str = jwt.encode(  # pyright: ignore[reportUnknownMemberType]
            payload, self.signing_key, algorithm=ALGORITHM
        )
        return encoded, TokenClaims(
            subject=subject,
            token_id=token_id,
            token_type=token_type,
            issued_at=issued_at,
            expires_at=expires_at,
            extra=dict(extra) if extra else {},
        )

    def decode(self, token: str, *, expected_type: str) -> TokenClaims:
        """校验并解出载荷；任何不符一律抛 TokenError。

        Args: token, expected_type。
        """
        payload = self._decode_with_any_key(token)
        if payload.get("typ") != expected_type:
            raise TokenError("令牌类型不符")
        return _to_claims(payload)

    def _decode_with_any_key(self, token: str) -> dict[str, Any]:
        last_error: Exception | None = None
        for key in self._keys():
            try:
                # ⚠ algorithms 必须显式给：留空会放行 alg=none 与算法混淆
                decoded: dict[str, Any] = (
                    jwt.decode(  # pyright: ignore[reportUnknownMemberType]
                        token,
                        key,
                        algorithms=[ALGORITHM],
                        issuer=self.issuer,
                        options={"require": ["exp", "iat", "sub", "jti"]},
                    )
                )
                return decoded
            except jwt.InvalidTokenError as error:
                last_error = error
        raise TokenError("令牌无效或已过期") from last_error

    def _keys(self) -> Sequence[str]:
        ordered = [self.signing_key]
        ordered.extend(
            key for key in self.verification_keys if key != self.signing_key
        )
        return ordered


def _to_claims(payload: dict[str, Any]) -> TokenClaims:
    reserved = {"sub", "jti", "typ", "iss", "iat", "exp"}
    return TokenClaims(
        subject=str(payload["sub"]),
        token_id=str(payload["jti"]),
        token_type=str(payload.get("typ", "")),
        issued_at=datetime.fromtimestamp(int(payload["iat"]), tz=UTC),
        expires_at=datetime.fromtimestamp(int(payload["exp"]), tz=UTC),
        extra={
            key: value for key, value in payload.items() if key not in reserved
        },
    )
