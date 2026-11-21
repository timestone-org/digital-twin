"""登录标识和稳定账号的失败计数与成功清理契约。"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import datetime
from typing import cast

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.crud import user_crud
from auth_server.apps.auth.crud.user import LoginCredentials
from auth_server.apps.auth.errors import (
    InvalidCredentials,
    TooManyLoginAttempts,
)
from auth_server.apps.auth.models import User
from auth_server.apps.auth.schemas import MeUpdateIn, SessionOut
from auth_server.apps.auth.services import auth_service as auth_module
from auth_server.apps.auth.services.api_key_service import ApiKeyService
from auth_server.apps.auth.services.auth_service import AuthService
from auth_server.apps.auth.services.bounded_hasher import BoundedHasher
from auth_server.apps.auth.services.identity import Identity
from auth_server.apps.auth.services.token_service import TokenService
from lib.auth import PasswordHasher
from lib.cache import Cache
from lib.errors import Conflict
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


@asynccontextmanager
async def session_factory() -> AsyncIterator[AsyncSession]:
    yield cast("AsyncSession", None)


class RacingSession:
    """预检之后另一请求抢先占了同一邮箱：唯一约束在 flush 时才报出来。"""

    async def flush(self) -> None:
        raise IntegrityError("UPDATE auth_users", None, Exception("dup"))


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
        hasher=BoundedHasher(HASHER, max_concurrency=2, name="test"),
        login_limiter=limiter,
        account_login_limiter=replace(limiter, namespace="login-account"),
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

    async def record_login(
        _session: AsyncSession,
        _credentials: LoginCredentials,
        _at: datetime,
        _upgraded_hash: str | None,
    ) -> User:
        return USER

    monkeypatch.setattr(user_crud, "get_by_login", find_user)
    monkeypatch.setattr(user_crud, "record_verified_login", record_login)
    monkeypatch.setattr(auth_module, "load_identity", identity_of)
    monkeypatch.setattr(AuthService, "_session_out", session_out)


async def login(service: AuthService, identifier: str) -> None:
    await service.login(
        session_factory,
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


@pytest.mark.parametrize("identifier", [USER.username, USER.email])
async def test_known_login_identifier_counts_against_the_account(
    identifier: str,
) -> None:
    cache = InMemoryCache()
    service = build_service(build_limiter(cache))

    with pytest.raises(InvalidCredentials):
        await service.login(session_factory, login=identifier, password="wrong")

    assert await cache.get(f"ratelimit:login-account:{USER.id}") == "1"
    assert await cache.get(f"ratelimit:login:{identifier.lower()}") == "1"


async def test_success_clears_account_attempts() -> None:
    cache = InMemoryCache()
    key = f"ratelimit:login-account:{USER.id}"
    await cache.incr_in_window(key, window_s=300)

    await login(build_service(build_limiter(cache)), USER.email)

    assert await cache.get(key) is None


async def test_unknown_login_keeps_alias_guard_and_dummy_verification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[bool] = []

    async def find_nobody(_session: AsyncSession, _login: str) -> None:
        return None

    async def verify_dummy(
        _hasher: BoundedHasher, _password: str, encoded: str
    ) -> bool:
        seen.append(encoded.startswith("$argon2id$"))
        return False

    monkeypatch.setattr(user_crud, "get_by_login", find_nobody)
    monkeypatch.setattr(BoundedHasher, "verify", verify_dummy)
    cache = InMemoryCache()
    service = build_service(build_limiter(cache))

    with pytest.raises(InvalidCredentials):
        await service.login(
            session_factory, login="absent-fixture", password="wrong"
        )

    assert seen == [True]
    assert cache.store == {"ratelimit:login:absent-fixture": "1"}


async def test_email_login_also_clears_the_username_count() -> None:
    limiter = build_limiter(InMemoryCache())
    for _ in range(LIMIT):
        await limiter.hit("alice")
    await login(build_service(limiter), "alice@example.com")
    assert await limiter.hit("alice") == 1


async def test_username_login_also_clears_the_email_count() -> None:
    limiter = build_limiter(InMemoryCache())
    for _ in range(LIMIT):
        await limiter.hit("alice@example.com")
    await login(build_service(limiter), "alice")
    assert await limiter.hit("alice@example.com") == 1


async def test_failed_logins_still_hit_the_limit() -> None:
    service = build_service(build_limiter(InMemoryCache()))
    for _ in range(LIMIT):
        with pytest.raises(InvalidCredentials):
            await service.login(
                session_factory, login="alice@example.com", password="wrong"
            )
    with pytest.raises(TooManyLoginAttempts) as caught:
        await login(service, "alice@example.com")
    # 前端按 40111 给「失败次数过多」的文案，通用限流码 40002 对不上
    assert caught.value.code == 40111


async def test_email_taken_by_a_concurrent_update_is_a_conflict() -> None:
    me = User(
        id=USER.id,
        username="alice",
        email="alice@example.com",
        hashed_password=USER.hashed_password,
        is_active=True,
    )
    service = build_service(build_limiter(InMemoryCache()))
    with pytest.raises(Conflict):
        await service.update_me(
            cast("AsyncSession", RacingSession()),
            user=me,
            payload=MeUpdateIn(email="bob@example.com"),
        )
