"""会话与个人资料自服务：登录、刷新、登出、注册、改自己的资料与密码。"""

import uuid
from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.crud import role_crud, user_crud
from auth_server.apps.auth.errors import (
    AccountDisabled,
    InvalidCredentials,
    SignupDisabled,
    TokenInvalid,
)
from auth_server.apps.auth.models import User
from auth_server.apps.auth.schemas import (
    ChangePasswordIn,
    MeUpdateIn,
    RegistrationIn,
    SessionOut,
    TokenPairOut,
    UserDetailOut,
)
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
from lib.auth import PasswordHasher
from lib.errors import Conflict, InfraError
from lib.logging import get_logger
from lib.ratelimit import FixedWindowLimiter
from lib.utils.timeutils import Clock

_logger = get_logger("auth.session")

# 用户不存在时也走一次散列校验，让「账号存在与否」不能由响应耗时推断
_TIMING_DECOY = (
    "$argon2id$v=19$m=65536,t=3,p=4$"
    "AAAAAAAAAAAAAAAAAAAAAA$0000000000000000000000000000000"
)


@dataclass(frozen=True)
class AuthService:
    """会话面的业务逻辑。事务边界在这一层。"""

    tokens: TokenService
    hasher: PasswordHasher
    login_limiter: FixedWindowLimiter
    signup_limiter: FixedWindowLimiter
    signup_enabled: bool
    signup_default_role: str
    clock: Clock

    async def login(
        self, session: AsyncSession, *, login: str, password: str
    ) -> SessionOut:
        """账号口令登录。失败次数按账号限流。

        Args: session, login（用户名或邮箱）, password。
        """
        await self.login_limiter.hit(login.strip().lower())
        user = await user_crud.get_by_login(session, login)
        if user is None:
            self.hasher.verify(password, _TIMING_DECOY)
            raise InvalidCredentials("用户名或密码错误")
        if not self.hasher.verify(password, user.hashed_password):
            _logger.info("login_failed", "口令不符", user_id=str(user.id))
            raise InvalidCredentials("用户名或密码错误")
        if not user.is_active:
            raise AccountDisabled("账号已停用，请联系管理员")
        await self._on_login_success(session, user, password)
        identity = await load_identity(session, user)
        return self._session_out(identity)

    async def refresh(
        self, session: AsyncSession, *, refresh_token: str
    ) -> SessionOut:
        """轮换令牌。旧刷新令牌立即失效，重复使用视为重放。

        Args: session, refresh_token。
        """
        user_id = await self.tokens.consume_refresh(
            refresh_token, now=self.clock()
        )
        identity = await load_identity_by_id(session, user_id)
        if identity is None:
            raise TokenInvalid("令牌对应的账号不存在")
        if not identity.user.is_active:
            raise AccountDisabled("账号已停用，请联系管理员")
        return self._session_out(identity)

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
            hashed_password=self.hasher.hash(payload.password),
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
        await session.flush()
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
        if not self.hasher.verify(
            payload.current_password, user.hashed_password
        ):
            raise InvalidCredentials("当前密码不正确")
        user.hashed_password = self.hasher.hash(payload.new_password)
        await session.flush()
        _logger.info("password_changed", "", user_id=str(user.id))

    async def _on_login_success(
        self, session: AsyncSession, user: User, password: str
    ) -> None:
        await self.login_limiter.reset(user.username.lower())
        user.last_login_at = self.clock()
        # 升过散列参数的旧口令在这一刻顺带重算，用户无感
        if self.hasher.needs_rehash(user.hashed_password):
            user.hashed_password = self.hasher.hash(password)
        await session.flush()
        _logger.info("login_succeeded", "", user_id=str(user.id))

    def _session_out(self, identity: Identity) -> SessionOut:
        pair = self.tokens.issue_pair(identity.user.id, now=self.clock())
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
