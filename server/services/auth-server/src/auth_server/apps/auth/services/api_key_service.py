"""API 密钥：给第三方系统用的常驻凭据，与 JWT 并列的第二种凭据。

存在的理由：access token 只有 15 分钟且**无法吊销**（吊销名单只拦刷新令牌）。
把它的有效期调大等于签一把在到期前收不回来的钥匙，而这把钥匙能写现场点位。
密钥换的是另一套取舍——不过期，但每次认证都回库判定吊销与账号状态。

⚠ 密钥只在 `/verify`（即经边缘访问**别的**服务）生效，auth-server 自己的
管理面一律不认它，见 `deps.get_identity`。否则一枚被盗的密钥可以给自己再签
一枚，吊销就永远追不上签发。
"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.crud import api_key_crud
from auth_server.apps.auth.crud.api_key import DEFAULT_ORDER
from auth_server.apps.auth.errors import TokenInvalid
from auth_server.apps.auth.models import KEY_TAG, PREFIX_LENGTH, ApiKey
from auth_server.apps.auth.schemas import (
    ApiKeyCreateIn,
    ApiKeyFilters,
    ApiKeyOut,
    ApiKeySecretOut,
)
from auth_server.apps.auth.services.audit import (
    ACTION_API_KEY_ISSUED,
    ACTION_API_KEY_REVOKED,
    Change,
    Entry,
    record,
)
from auth_server.apps.auth.services.guards import assert_target_not_higher
from auth_server.apps.auth.services.identity import (
    Identity,
    Operation,
    load_identity_by_id,
)
from auth_server.apps.auth.services.presenters import to_api_key_out
from lib.auth import PasswordHasher
from lib.cache import CacheLike
from lib.errors import DependencyUnavailable, NotFound
from lib.logging import get_logger
from lib.utils.timeutils import Clock, to_utc
from lib.web import Page, PageParams

_logger = get_logger("auth.api_key")

TARGET_TYPE = "api_key"

# 明文的三段结构：`dtk_<前缀>_<密钥体>`
_SEPARATOR = "_"
_SEGMENTS = 3
# 32 字节 ≈ 256 位熵，与 JWT 的签名强度同档
_SECRET_BYTES = 32
_CACHE_PREFIX = "auth:apikey:verified:"


@dataclass(frozen=True)
class MintedKey:
    """新签发的一枚密钥。`plaintext` 出这个函数之后只会被写进响应一次。"""

    prefix: str
    secret: str
    plaintext: str


def looks_like_api_key(raw: str) -> bool:
    """这串 Bearer 值是不是一枚 API 密钥（而不是 JWT）。

    Args: raw。
    """
    return raw.startswith(f"{KEY_TAG}{_SEPARATOR}")


def parse_api_key(raw: str) -> tuple[str, str] | None:
    """把明文拆成 `(前缀, 密钥体)`；形状不对返回 None。

    ⚠ `maxsplit` 必须是 2：密钥体由 `token_urlsafe` 生成，字母表里**含下划线**。
    不限制切分次数就会把它从中间劈开，表现为「有些密钥一直认证失败」——
    失败与否取决于随机字节，查起来会一路怀疑到散列算法去。

    Args: raw。
    """
    parts = raw.split(_SEPARATOR, _SEGMENTS - 1)
    if len(parts) != _SEGMENTS or parts[0] != KEY_TAG:
        return None
    prefix, secret = parts[1], parts[2]
    if not prefix or not secret:
        return None
    return prefix, secret


def mint_key() -> MintedKey:
    """生成一枚新密钥。前缀入库可展示，密钥体只留散列。"""
    prefix = secrets.token_hex(PREFIX_LENGTH // 2)
    secret = secrets.token_urlsafe(_SECRET_BYTES)
    return MintedKey(
        prefix=prefix,
        secret=secret,
        plaintext=f"{KEY_TAG}{_SEPARATOR}{prefix}{_SEPARATOR}{secret}",
    )


async def list_keys(
    session: AsyncSession,
    *,
    filters: ApiKeyFilters,
    page: PageParams,
    now: datetime,
) -> Page[ApiKeyOut]:
    """分页列出密钥。默认只列未吊销的。

    Args: session, filters, page, now。
    """
    rows, total = await api_key_crud.list_page(
        session,
        statement=api_key_crud.build_query(
            user_id=filters.user_id,
            should_include_revoked=filters.should_include_revoked,
        ).order_by(*DEFAULT_ORDER),
        offset=page.offset,
        limit=page.size,
    )
    return Page[ApiKeyOut](
        items=[to_api_key_out(row, now=now) for row in rows],
        page=page.page,
        size=page.size,
        total=total,
    )


@dataclass(frozen=True)
class ApiKeyService:
    """密钥的签发、认证与吊销。"""

    hasher: PasswordHasher
    cache: CacheLike
    clock: Clock
    verify_cache_ttl_s: int
    touch_interval_s: int

    async def authenticate(self, session: AsyncSession, raw: str) -> uuid.UUID:
        """校验一枚密钥，返回它代表的用户 id。

        ⚠ 失败原因一律收敛成同一条消息：区分「密钥不存在」与「密钥体不对」
        会把本端点变成可枚举前缀的 oracle。

        Args: session, raw（Bearer 里的明文）。
        """
        parsed = parse_api_key(raw)
        if parsed is None:
            raise TokenInvalid("API 密钥无效或已失效")
        row = await api_key_crud.get_by_prefix(session, parsed[0])
        now = self.clock()
        if row is None or not row.is_usable(now):
            raise TokenInvalid("API 密钥无效或已失效")
        await self._assert_secret(row, secret=parsed[1], raw=raw)
        self._touch(row, now)
        return row.user_id

    async def issue(
        self,
        session: AsyncSession,
        operation: Operation,
        *,
        payload: ApiKeyCreateIn,
    ) -> ApiKeySecretOut:
        """给某个账号签发一枚密钥。

        ⚠ 与「重置他人密码」同一档风险：拿到密钥就等于能以该账号的身份行事。
        不挡住「给权限比自己高的账号签发」，低权账号一步即可横向接管。

        Args: session, operation, payload。
        """
        owner = await self._require_owner(session, payload.user_id)
        assert_target_not_higher(
            operator_codes=operation.operator.codes,
            target_codes=owner.codes,
            is_super=operation.operator.is_super,
            action="签发 API 密钥",
        )
        minted = mint_key()
        now = self.clock()
        row = ApiKey(
            user_id=owner.user.id,
            name=payload.name,
            prefix=minted.prefix,
            hashed_secret=self.hasher.hash(minted.secret),
            expires_at=_expiry(now, payload.expires_in_days),
            issued_by=operation.operator.user.id,
        )
        session.add(row)
        await session.flush()
        _audit(session, operation, ACTION_API_KEY_ISSUED, row)
        _logger.info("api_key_issued", "", key_id=str(row.id))
        return ApiKeySecretOut(
            api_key=to_api_key_out(row, now=now), secret=minted.plaintext
        )

    async def revoke(
        self,
        session: AsyncSession,
        operation: Operation,
        *,
        key_id: uuid.UUID,
    ) -> ApiKeyOut:
        """吊销一枚密钥。重复吊销无副作用，且**不删行**——审计要留痕。

        Args: session, operation, key_id。
        """
        row = await api_key_crud.get(session, key_id)
        if row is None:
            raise NotFound("API 密钥不存在")
        owner = await self._require_owner(session, row.user_id)
        assert_target_not_higher(
            operator_codes=operation.operator.codes,
            target_codes=owner.codes,
            is_super=operation.operator.is_super,
            action="吊销 API 密钥",
        )
        now = self.clock()
        if row.revoked_at is None:
            row.revoked_at = now
            await session.flush()
            _audit(session, operation, ACTION_API_KEY_REVOKED, row)
            _logger.info("api_key_revoked", "", key_id=str(row.id))
        # 顺手清掉散列校验缓存，省掉那一个窗口的无谓 argon2。
        # ⚠ 这不是吊销生效的手段：生效靠的是上面那一列 `revoked_at`，
        # 认证时每次回库判定。清缓存失败也不影响吊销，故它是尽力而为的。
        await self._forget(row.id)
        return to_api_key_out(row, now=now)

    async def _assert_secret(
        self, row: ApiKey, *, secret: str, raw: str
    ) -> None:
        """比对密钥体。散列结果按密钥缓存，跳过热路径上的 argon2。

        ⚠ 缓存里放的只是「这串明文的摘要通过了散列校验」这一件事，而且**永远
        在吊销与过期判定之后**才被读到（见 `authenticate`）。它省的是算力，
        不是判定：一枚已吊销的密钥不会因为命中缓存而多活哪怕一次请求。
        `/verify` 是全站前置且只有 500ms 超时，而 argon2 是刻意慢的——
        不缓存这一步，边缘会整片超时按拒绝处理。

        ⚠ Redis 不可达时**退回逐次 argon2**，不是拒绝。这一层是性能件，
        让它 fail-closed 等于 Redis 一抖第三方系统就全线写不进值，
        而那正是这枚密钥要保障的链路。

        Args: row, secret, raw。
        """
        digest = _digest(raw)
        if await self._recall(row.id) == digest:
            return
        if not self.hasher.verify(secret, row.hashed_secret):
            raise TokenInvalid("API 密钥无效或已失效")
        await self._remember(row.id, digest)

    async def _recall(self, key_id: uuid.UUID) -> str | None:
        try:
            cached = await self.cache.get_json(_cache_key(key_id))
        except DependencyUnavailable:
            _logger.warning("api_key_cache_unavailable", "退回逐次散列校验")
            return None
        return cached if isinstance(cached, str) else None

    async def _remember(self, key_id: uuid.UUID, digest: str) -> None:
        try:
            await self.cache.set_json(
                _cache_key(key_id), digest, ttl_s=self.verify_cache_ttl_s
            )
        except DependencyUnavailable:
            _logger.warning("api_key_cache_unavailable", "校验结果未能缓存")

    async def _forget(self, key_id: uuid.UUID) -> None:
        try:
            await self.cache.delete(_cache_key(key_id))
        except DependencyUnavailable:
            # ⚠ 吊销**不能**因此失败：那一列已经写进事务，回滚掉才是真的漏洞
            _logger.warning("api_key_cache_unavailable", "吊销未能清缓存")

    def _touch(self, row: ApiKey, now: datetime) -> None:
        """记一次使用时刻，按分钟级节流。

        ⚠ 每次认证都 UPDATE 会把纯读链路变成写链路，而 `/verify` 是全站前置。
        ⚠ 它随请求事务落库，故只有鉴权也通过的那些请求才会留下痕迹。

        Args: row, now。
        """
        last = row.last_used_at
        if last is not None:
            elapsed = (now - to_utc(last)).total_seconds()
            if elapsed < self.touch_interval_s:
                return
        row.last_used_at = now

    @staticmethod
    async def _require_owner(
        session: AsyncSession, user_id: uuid.UUID
    ) -> Identity:
        owner = await load_identity_by_id(session, user_id)
        if owner is None:
            raise NotFound("用户不存在")
        return owner


def _expiry(now: datetime, days: int | None) -> datetime | None:
    return None if days is None else now + timedelta(days=days)


def _digest(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _cache_key(key_id: uuid.UUID) -> str:
    return f"{_CACHE_PREFIX}{key_id}"


def _audit(
    session: AsyncSession, operation: Operation, action: str, key: ApiKey
) -> None:
    record(
        session,
        Entry(
            actor=operation.operator.user,
            action=action,
            target_type=TARGET_TYPE,
            target_id=str(key.id),
            # ⚠ 快照里没有 hashed_secret：审计表比业务表更常被导出
            change=Change(
                after={
                    "name": key.name,
                    "prefix": key.prefix,
                    "user_id": str(key.user_id),
                    "expires_at": _iso(key.expires_at),
                    "revoked_at": _iso(key.revoked_at),
                }
            ),
            source_ip=operation.source_ip,
        ),
    )


def _iso(value: datetime | None) -> str | None:
    return None if value is None else to_utc(value).isoformat()
