"""会话与个人资料自服务：登录、刷新、登出、注册、改自己的资料与密码。"""

import uuid
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.crud import role_crud, user_crud
from auth_server.apps.auth.crud.user import LoginCredentials
from auth_server.apps.auth.errors import (
    AccountDisabled,
    CurrentPasswordIncorrect,
    InvalidCredentials,
    SignupDisabled,
    TokenInvalid,
    TooManyLoginAttempts,
)
from auth_server.apps.auth.models import User
from auth_server.apps.auth.schemas import (
    AccessTokenOut,
    ChangePasswordIn,
    EmbedSessionOut,
    MeUpdateIn,
    RegistrationIn,
    SessionOut,
    TokenPairOut,
    UserDetailOut,
)
from auth_server.apps.auth.services.api_key_service import ApiKeyService
from auth_server.apps.auth.services.bounded_hasher import BoundedHasher
from auth_server.apps.auth.services.identity import (
    Identity,
    load_identity,
    load_identity_by_id,
)
from auth_server.apps.auth.services.presenters import to_user_detail
from auth_server.apps.auth.services.token_service import (
    TokenPair,
    TokenService,
)
from lib.errors import Conflict, InfraError, RateLimited
from lib.logging import get_logger
from lib.ratelimit import FixedWindowLimiter
from lib.utils.timeutils import Clock

_logger = get_logger("auth.session")

SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# 用户不存在时也走一次散列校验，让「账号存在与否」不能由响应耗时推断
_TIMING_DECOY = (
    "$argon2id$v=19$m=65536,t=3,p=4$"
    "AAAAAAAAAAAAAAAAAAAAAA$0000000000000000000000000000000"
)


@dataclass(frozen=True)
class AuthService:
    """会话面的业务逻辑。事务边界在这一层。"""

    tokens: TokenService
    api_keys: ApiKeyService
    hasher: BoundedHasher
    login_limiter: FixedWindowLimiter
    signup_limiter: FixedWindowLimiter
    signup_enabled: bool
    signup_default_role: str
    clock: Clock

    async def login(
        self, sessions: SessionFactory, *, login: str, password: str
    ) -> SessionOut:
        """账号口令登录。失败次数按账号限流。

        Args: sessions, login（用户名或邮箱）, password。
        """
        login_key = login.strip().lower()
        try:
            await self.login_limiter.hit(login_key)
        except RateLimited as error:
            # 登录场景有自己的错误码，前端按它给文案；通用限流码对不上
            raise TooManyLoginAttempts(
                error.message, context=error.context
            ) from error
        async with sessions() as session:
            user = await user_crud.get_by_login(session, login)
            credentials = LoginCredentials.from_user(user) if user else None
        if credentials is None:
            await self.hasher.verify(password, _TIMING_DECOY)
            raise InvalidCredentials("用户名或密码错误")
        await self._verify_login_password(credentials, password)
        upgraded = (
            await self.hasher.hash(password)
            if self.hasher.needs_rehash(credentials.hashed_password)
            else None
        )
        identity = await self._confirm_login(sessions, credentials, upgraded)
        if identity is None:
            identity = await self._confirm_concurrent_rehash(
                sessions, credentials, password
            )
        user = identity.user
        for key in {login_key, user.username.lower(), user.email.lower()}:
            await self.login_limiter.reset(key)
        _logger.info("login_succeeded", "", user_id=str(user.id))
        return self._session_out(identity)

    async def refresh(
        self, session: AsyncSession, *, refresh_token: str
    ) -> SessionOut:
        """轮换令牌。旧刷新令牌立即失效，重复使用视为重放。

        Args: session, refresh_token。
        """
        grant = await self.tokens.consume_refresh_grant(
            refresh_token, now=self.clock()
        )
        identity = await load_identity_by_id(session, grant.user_id)
        if identity is None:
            raise TokenInvalid("令牌对应的账号不存在")
        grant.require_generation(identity.user.refresh_generation)
        if not identity.user.is_active:
            raise AccountDisabled("账号已停用，请联系管理员")
        return self._session_out(identity)

    async def create_embed_session(
        self, session: AsyncSession, *, api_key: str
    ) -> EmbedSessionOut:
        """用 API 密钥创建无刷新能力的短期嵌入会话。

        Args: session, api_key。
        """
        user_id = await self.api_keys.authenticate(session, api_key)
        identity = await load_identity_by_id(session, user_id)
        if identity is None:
            raise TokenInvalid("API 密钥对应的账号不存在")
        if not identity.user.is_active:
            raise AccountDisabled("账号已停用，请联系管理员")
        issued = self.tokens.issue_embed_access(
            identity.user.id,
            now=self.clock(),
        )
        _logger.info("embed_session_created", "", user_id=str(identity.user.id))
        return EmbedSessionOut(
            token=AccessTokenOut(
                access_token=issued.access_token,
                expires_in_s=issued.expires_in_s,
            ),
            user=to_user_detail(identity),
        )

    async def logout(self, *, refresh_token: str) -> None:
        """登出。重复调用无副作用。

        Args: refresh_token。
        """
        await self.tokens.revoke_refresh(refresh_token, now=self.clock())

    async def register(
        self, session: AsyncSession, *, payload: RegistrationIn
    ) -> UserDetailOut:
        """自助注册。角色由服务端按配置指派。

        Args: session, payload。
        """
        if not self.signup_enabled:
            raise SignupDisabled("本系统未开放自助注册")
        await self.signup_limiter.hit(payload.username.lower())
        role = await role_crud.get_by_name(session, self.signup_default_role)
        if role is None:
            raise InfraError(
                "注册暂时不可用",
                context={"missing_role": self.signup_default_role},
            )
        user = User(
            username=payload.username,
            email=payload.email,
            hashed_password=await self.hasher.hash(payload.password),
            full_name=payload.full_name,
            role_id=role.id,
            is_active=True,
        )
        await self._insert_user(session, user)
        _logger.info("user_registered", "", user_id=str(user.id))
        return to_user_detail(await load_identity(session, user))

    async def update_me(
        self,
        session: AsyncSession,
        *,
        user: User,
        payload: MeUpdateIn,
    ) -> UserDetailOut:
        """改自己的资料。改不了启停、角色与权限。

        Args: session, user, payload。
        """
        changes = payload.model_dump(exclude_unset=True)
        if "email" in changes and await self._email_taken(
            session, changes["email"], user.id
        ):
            raise Conflict("该邮箱已被占用")
        user_crud.apply_changes(user, changes)
        try:
            await session.flush()
        except IntegrityError as error:
            # 预检之后仍可能被并发请求抢先，唯一约束才是最后一道
            raise Conflict("该邮箱已被占用") from error
        return to_user_detail(await load_identity(session, user))

    async def change_password(
        self,
        session: AsyncSession,
        *,
        user: User,
        payload: ChangePasswordIn,
    ) -> None:
        """改自己的密码，必须验旧密码。

        Args: session, user, payload。
        """
        if not await self.hasher.verify(
            payload.current_password, user.hashed_password
        ):
            raise CurrentPasswordIncorrect("当前密码不正确")
        changed = await user_crud.rotate_password(
            session,
            user,
            await self.hasher.hash(payload.new_password),
        )
        if not changed:
            raise CurrentPasswordIncorrect("当前密码已变更，请重新登录")
        _logger.info("password_changed", "", user_id=str(user.id))

    async def _verify_login_password(
        self, credentials: LoginCredentials, password: str
    ) -> None:
        if not await self.hasher.verify(password, credentials.hashed_password):
            _logger.info(
                "login_failed", "口令不符", user_id=str(credentials.user_id)
            )
            raise InvalidCredentials("用户名或密码错误")
        if not credentials.is_active:
            raise AccountDisabled("账号已停用，请联系管理员")

    async def _confirm_login(
        self,
        sessions: SessionFactory,
        credentials: LoginCredentials,
        upgraded_hash: str | None,
    ) -> Identity | None:
        async with sessions() as session:
            user = await user_crud.record_verified_login(
                session, credentials, self.clock(), upgraded_hash
            )
            if user is None:
                return None
            return await load_identity(session, user)

    async def _confirm_concurrent_rehash(
        self,
        sessions: SessionFactory,
        credentials: LoginCredentials,
        password: str,
    ) -> Identity:
        async with sessions() as session:
            user = await user_crud.get(session, credentials.user_id)
            current = LoginCredentials.from_user(user) if user else None
        if (
            current is None
            or current.refresh_generation != credentials.refresh_generation
        ):
            raise InvalidCredentials("用户名或密码错误")
        # 同一口令的并发重散列不改变刷新代次，须重新验证散列再确认。
        if not current.is_active:
            raise AccountDisabled("账号已停用，请联系管理员")
        if not await self.hasher.verify(password, current.hashed_password):
            raise InvalidCredentials("用户名或密码错误")
        identity = await self._confirm_login(sessions, current, None)
        if identity is None:
            raise InvalidCredentials("登录期间凭据已更新，请重新登录")
        return identity

    def _session_out(self, identity: Identity) -> SessionOut:
        pair = self.tokens.issue_pair(
            identity.user.id,
            generation=identity.user.refresh_generation,
            now=self.clock(),
        )
        return SessionOut(
            token=_to_token_out(pair), user=to_user_detail(identity)
        )

    @staticmethod
    async def _insert_user(session: AsyncSession, user: User) -> None:
        session.add(user)
        try:
            await session.flush()
        except IntegrityError as error:
            # 唯一约束才是并发下唯一可靠的手段，「先查再插」不是
            raise Conflict("用户名或邮箱已被占用") from error

    @staticmethod
    async def _email_taken(
        session: AsyncSession, email: str, current_id: uuid.UUID
    ) -> bool:
        owner = await user_crud.get_by_login(session, email)
        return owner is not None and owner.id != current_id


def _to_token_out(pair: TokenPair) -> TokenPairOut:
    return TokenPairOut(
        access_token=pair.access_token,
        refresh_token=pair.refresh_token,
        expires_in_s=pair.expires_in_s,
    )
