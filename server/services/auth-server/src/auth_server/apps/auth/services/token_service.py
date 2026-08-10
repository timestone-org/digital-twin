"""令牌签发、轮换与吊销。

刷新一次即轮换两枚令牌，旧刷新令牌进吊销名单；名单命中视为**重放**并整体拒绝。
⚠ 名单在 Redis 上：Redis 不可达时刷新一律失败（fail-closed）。放行等于让被盗的
刷新令牌在缓存故障期间恢复效力。
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from auth_server.apps.auth.errors import (
    RefreshTokenRejected,
    TokenInvalid,
)
from lib.auth import JwtCodec, TokenClaims, TokenError
from lib.cache import CacheLike
from lib.utils.timeutils import utcnow

ACCESS_TYPE = "access"
REFRESH_TYPE = "refresh"
_REVOKED_PREFIX = "auth:refresh:revoked:"
_BEARER_PREFIX = "bearer "


def parse_bearer(authorization: str | None) -> str | None:
    """从 `Authorization` 头取出 Bearer 令牌；不是 Bearer 或为空返回 None。

    Args: authorization。
    """
    if not authorization:
        return None
    if not authorization.lower().startswith(_BEARER_PREFIX):
        return None
    return authorization[len(_BEARER_PREFIX) :].strip() or None


@dataclass(frozen=True)
class TokenPair:
    """一对令牌与 access 的有效期。"""

    access_token: str
    refresh_token: str
    expires_in_s: int


@dataclass(frozen=True)
class TokenService:
    """令牌的全部生命周期。时钟可注入，测试不依赖真实时间。"""

    codec: JwtCodec
    cache: CacheLike
    access_ttl_s: int
    refresh_ttl_s: int

    def issue_pair(
        self, user_id: uuid.UUID, *, now: datetime | None = None
    ) -> TokenPair:
        """为一个用户签发一对新令牌。

        Args: user_id, now。
        """
        moment = now or utcnow()
        access, _ = self.codec.issue(
            subject=str(user_id),
            token_type=ACCESS_TYPE,
            ttl_s=self.access_ttl_s,
            now=moment,
        )
        refresh, _ = self.codec.issue(
            subject=str(user_id),
            token_type=REFRESH_TYPE,
            ttl_s=self.refresh_ttl_s,
            now=moment,
        )
        return TokenPair(
            access_token=access,
            refresh_token=refresh,
            expires_in_s=self.access_ttl_s,
        )

    def decode_access(self, token: str) -> TokenClaims:
        """校验 access token；不合法抛 TokenInvalid。

        Args: token。
        """
        try:
            return self.codec.decode(token, expected_type=ACCESS_TYPE)
        except TokenError as error:
            raise TokenInvalid("令牌无效或已过期") from error

    async def consume_refresh(
        self, token: str, *, now: datetime | None = None
    ) -> uuid.UUID:
        """校验并**一次性消费**刷新令牌，返回它代表的用户 id。

        Args: token, now。
        """
        try:
            claims = self.codec.decode(token, expected_type=REFRESH_TYPE)
        except TokenError as error:
            raise TokenInvalid("刷新令牌无效或已过期") from error
        if await self.cache.exists(_key(claims.token_id)):
            raise RefreshTokenRejected(
                "刷新令牌已失效，请重新登录",
                context={"token_id": claims.token_id},
            )
        await self._revoke(claims, now=now or utcnow())
        return _subject_uuid(claims)

    async def revoke_refresh(
        self, token: str, *, now: datetime | None = None
    ) -> None:
        """登出：把刷新令牌放进吊销名单。重复调用无副作用。

        Args: token, now。
        """
        try:
            claims = self.codec.decode(token, expected_type=REFRESH_TYPE)
        except TokenError:
            # 已过期或本就不合法的令牌无需吊销，登出照样算成功
            return
        await self._revoke(claims, now=now or utcnow())

    async def _revoke(self, claims: TokenClaims, *, now: datetime) -> None:
        remaining = int((claims.expires_at - now).total_seconds())
        if remaining <= 0:
            return
        await self.cache.set_json(_key(claims.token_id), True, ttl_s=remaining)


def _key(token_id: str) -> str:
    return f"{_REVOKED_PREFIX}{token_id}"


def _subject_uuid(claims: TokenClaims) -> uuid.UUID:
    try:
        return uuid.UUID(claims.subject)
    except ValueError as error:
        raise TokenInvalid("令牌主体不是合法标识") from error
