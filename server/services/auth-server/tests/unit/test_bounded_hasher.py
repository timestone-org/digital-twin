"""argon2 通道：散列不许回到事件循环，并发不许超过配置上限。

⚠ 上限是内存预算：每路约 64MiB，走默认执行器时并发随核数涨，
配了 cgroup 限额的部署会被 OOMKill。
"""

import asyncio
import threading
import uuid
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.crud import user_crud
from auth_server.apps.auth.errors import InvalidCredentials, TokenInvalid
from auth_server.apps.auth.models import ApiKey, User
from auth_server.apps.auth.services.api_key_service import ApiKeyService
from auth_server.apps.auth.services.auth_service import AuthService
from auth_server.apps.auth.services.bounded_hasher import BoundedHasher
from auth_server.apps.auth.services.token_service import TokenService
from auth_server.container import build_container
from auth_server.settings import Settings
from lib.auth import PasswordHasher
from lib.cache import Cache, CacheLike
from lib.ratelimit import FixedWindowLimiter
from lib.testing import FrozenClock, InMemoryCache
from lib.utils.timeutils import utcnow

PASSWORD = "correct-horse"
MAX_CONCURRENCY = 2
CALLERS = 8
THREAD_WAIT_S = 5.0

# 与种子账号同参，理由见 test_auth_service
HASHER = PasswordHasher()
STORED = HASHER.hash(PASSWORD)


class SpyHasher(PasswordHasher):
    """照常算真散列，同时记下所在线程和同时在算的路数。"""

    def __init__(self) -> None:
        super().__init__()
        self._lock = threading.Lock()
        self._active = 0
        self.peak = 0
        self.threads: set[int] = set()

    def _enter(self) -> None:
        with self._lock:
            self._active += 1
            self.peak = max(self.peak, self._active)
            self.threads.add(threading.get_ident())

    def _leave(self) -> None:
        with self._lock:
            self._active -= 1

    def hash(self, raw: str) -> str:
        self._enter()
        try:
            return super().hash(raw)
        finally:
            self._leave()

    def verify(self, raw: str, hashed: str) -> bool:
        self._enter()
        try:
            return super().verify(raw, hashed)
        finally:
            self._leave()


class HeldHasher(PasswordHasher):
    """校验卡在闸上，好让用例摆出「池已占满」的现场。"""

    def __init__(self) -> None:
        super().__init__()
        self.started = threading.Event()
        self.released = threading.Event()

    def verify(self, raw: str, hashed: str) -> bool:
        self.started.set()
        self.released.wait(THREAD_WAIT_S)
        return super().verify(raw, hashed)


def bounded(spy: PasswordHasher, limit: int = MAX_CONCURRENCY) -> BoundedHasher:
    return BoundedHasher(spy, max_concurrency=limit, name="test")


def assert_off_loop_and_bounded(spy: SpyHasher) -> None:
    assert spy.threads
    assert threading.get_ident() not in spy.threads
    assert spy.peak <= MAX_CONCURRENCY


def build_auth(spy: SpyHasher) -> AuthService:
    limiter = FixedWindowLimiter(
        cache=cast("Cache", InMemoryCache()),
        namespace="login",
        limit=CALLERS * 2,
        window_s=300,
    )
    return AuthService(
        tokens=cast("TokenService", None),
        api_keys=cast("ApiKeyService", None),
        hasher=bounded(spy),
        login_limiter=limiter,
        signup_limiter=limiter,
        signup_enabled=False,
        signup_default_role="viewer",
        clock=utcnow,
    )


def build_api_keys(spy: SpyHasher) -> ApiKeyService:
    return ApiKeyService(
        hasher=bounded(spy),
        cache=cast("CacheLike", InMemoryCache()),
        clock=FrozenClock(utcnow()),
        verify_cache_ttl_s=60,
        touch_interval_s=60,
    )


async def test_round_trip_keeps_the_sync_hasher_semantics() -> None:
    hasher = bounded(HASHER)
    stored = await hasher.hash(PASSWORD)
    assert await hasher.verify(PASSWORD, stored)
    assert not await hasher.verify("wrong", stored)
    assert not hasher.needs_rehash(stored)


async def test_hashing_runs_off_the_loop_within_the_limit() -> None:
    spy = SpyHasher()
    hasher = bounded(spy)
    await asyncio.gather(*(hasher.hash(PASSWORD) for _ in range(CALLERS)))
    assert_off_loop_and_bounded(spy)


@pytest.mark.parametrize(
    "account",
    [
        pytest.param(User(hashed_password=STORED), id="known-account"),
        pytest.param(None, id="timing-decoy"),
    ],
)
async def test_concurrent_logins_share_the_bounded_lane(
    monkeypatch: pytest.MonkeyPatch, account: User | None
) -> None:
    async def find_user(_session: AsyncSession, _login: str) -> User | None:
        return account

    monkeypatch.setattr(user_crud, "get_by_login", find_user)
    spy = SpyHasher()
    service = build_auth(spy)
    outcomes = await asyncio.gather(
        *(
            service.login(
                cast("AsyncSession", None),
                login=f"user-{index}",
                password="wrong",
            )
            for index in range(CALLERS)
        ),
        return_exceptions=True,
    )
    assert all(isinstance(item, InvalidCredentials) for item in outcomes)
    assert_off_loop_and_bounded(spy)


async def test_api_key_checks_share_the_bounded_lane() -> None:
    spy = SpyHasher()
    service = build_api_keys(spy)
    rows = [
        ApiKey(id=uuid.uuid4(), hashed_secret=STORED) for _ in range(CALLERS)
    ]
    outcomes = await asyncio.gather(
        *(
            service._assert_secret(row, secret="forged", raw="dtk_x_forged")
            for row in rows
        ),
        return_exceptions=True,
    )
    assert all(isinstance(item, TokenInvalid) for item in outcomes)
    assert_off_loop_and_bounded(spy)


async def test_close_cancels_the_queue_but_not_the_running_hash() -> None:
    held = HeldHasher()
    hasher = bounded(held, limit=1)
    running = asyncio.ensure_future(hasher.verify(PASSWORD, STORED))
    assert await asyncio.to_thread(held.started.wait, THREAD_WAIT_S)
    queued = asyncio.ensure_future(hasher.verify(PASSWORD, STORED))
    await asyncio.sleep(0)
    await hasher.close()
    with pytest.raises(asyncio.CancelledError):
        await queued
    held.released.set()
    assert await running


def test_default_lanes_stay_within_the_memory_budget() -> None:
    fields = Settings.model_fields
    password = fields["argon2_password_max_concurrency"].default
    api_key = fields["argon2_api_key_max_concurrency"].default
    assert password + api_key <= 4


def test_api_keys_get_their_own_lane() -> None:
    settings = Settings(
        jwt_secret="j" * 32,
        edge_signing_secret="s" * 32,
        edge_service_key="k" * 32,
        postgres_host="db",
        postgres_user="auth",
        postgres_password="unused",
        postgres_db="digitaltwin",
        redis_host="redis",
    )
    container = build_container(settings)
    assert container.auth.hasher is container.hasher
    assert container.api_keys.hasher is not container.hasher
