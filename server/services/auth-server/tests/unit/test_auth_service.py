"""登录限流计数：hit 与 reset 必须落在同一个键上。

⚠ 登录入参可以是用户名也可以是邮箱，计数按入参走。清错键时用户每次都登录成功，
也会在窗口内被当成撞库拒绝。
"""

import uuid
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.crud import user_crud
from auth_server.apps.auth.errors import InvalidCredentials
from auth_server.apps.auth.models import User
from auth_server.apps.auth.schemas import SessionOut
from auth_server.apps.auth.services import auth_service as auth_module
from auth_server.apps.auth.services.api_key_service import ApiKeyService
from auth_server.apps.auth.services.auth_service import AuthService
from auth_server.apps.auth.services.identity import Identity
from auth_server.apps.auth.services.token_service import TokenService
from lib.auth import PasswordHasher
from lib.cache import Cache
from lib.errors import RateLimited
from lib.ratelimit import FixedWindowLimiter
from lib.testing import InMemoryCache
from lib.utils.timeutils import utcnow

PASSWORD = "correct-horse"
LIMIT = 2

# 与种子账号同参，理由见 conftest
HASHER = PasswordHasher()
USER = User(
    id=uuid.UUID("00000000-0000-4000-8000-000000000001"),
    username="Alice",
    email="alice@example.com",
    hashed_password=HASHER.hash(PASSWORD),
    is_active=True,
)


class FakeSession:
    """登录路径只会 flush 一次，别的调用都该是缺陷。"""

    async def flush(self) -> None:
        return None


def build_limiter(cache: InMemoryCache) -> FixedWindowLimiter:
    return FixedWindowLimiter(
        cache=cast("Cache", cache),
        namespace="login",
        limit=LIMIT,
        window_s=300,
    )


def build_service(limiter: FixedWindowLimiter) -> AuthService:
    return AuthService(
        tokens=cast("TokenService", None),
        api_keys=cast("ApiKeyService", None),
        hasher=HASHER,
        login_limiter=limiter,
        signup_limiter=limiter,
        signup_enabled=False,
        signup_default_role="viewer",
        clock=utcnow,
    )


@pytest.fixture(autouse=True)
def known_account(monkeypatch: pytest.MonkeyPatch) -> None:
    async def find_user(_session: AsyncSession, _login: str) -> User:
        return USER

    async def identity_of(_session: AsyncSession, user: User) -> Identity:
        return Identity(user, frozenset(), frozenset(), frozenset())

    def session_out(_self: AuthService, _identity: Identity) -> SessionOut:
        return cast("SessionOut", None)

    monkeypatch.setattr(user_crud, "get_by_login", find_user)
    monkeypatch.setattr(auth_module, "load_identity", identity_of)
    monkeypatch.setattr(AuthService, "_session_out", session_out)


async def login(service: AuthService, identifier: str) -> None:
    await service.login(
        cast("AsyncSession", FakeSession()),
        login=identifier,
        password=PASSWORD,
    )


@pytest.mark.parametrize(
    "identifier",
    ["alice", " ALICE ", "alice@example.com", "  Alice@Example.COM "],
)
async def test_successful_logins_never_exhaust_the_limit(
    identifier: str,
) -> None:
    limiter = build_limiter(InMemoryCache())
    service = build_service(limiter)
    for _ in range(LIMIT + 1):
        await login(service, identifier)
    assert await limiter.hit(identifier.strip().lower()) == 1


async def test_email_login_also_clears_the_username_count() -> None:
    limiter = build_limiter(InMemoryCache())
    for _ in range(LIMIT):
        await limiter.hit("alice")
    await login(build_service(limiter), "alice@example.com")
    assert await limiter.hit("alice") == 1


async def test_failed_logins_still_hit_the_limit() -> None:
    service = build_service(build_limiter(InMemoryCache()))
    session = cast("AsyncSession", FakeSession())
    for _ in range(LIMIT):
        with pytest.raises(InvalidCredentials):
            await service.login(
                session, login="alice@example.com", password="wrong"
            )
    with pytest.raises(RateLimited):
        await login(service, "alice@example.com")
