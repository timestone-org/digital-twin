"""组合根：把配置拧成各个协作对象。装配只在这里发生，模块顶层不做副作用。"""

from dataclasses import dataclass

from auth_server.apps.auth.services import (
    AuthService,
    RouteRuleCache,
    TokenService,
    VerifyService,
)
from auth_server.settings import Settings
from lib.auth import JwtCodec, PasswordHasher
from lib.cache import Cache
from lib.db import Database, PoolProfile
from lib.ratelimit import FixedWindowLimiter
from lib.utils.timeutils import Clock, utcnow


@dataclass(frozen=True)
class Container:
    """一个进程内的全部长生命周期对象。"""

    settings: Settings
    database: Database
    cache: Cache
    hasher: PasswordHasher
    tokens: TokenService
    auth: AuthService
    verify: VerifyService
    rules: RouteRuleCache


def _build_database(settings: Settings) -> Database:
    return Database(
        dsn=settings.dsn(),
        profile=PoolProfile(
            pool_size=settings.postgres_pool_size,
            max_overflow=settings.postgres_pool_overflow,
            connect_timeout_s=settings.postgres_connect_timeout_s,
            statement_timeout_ms=settings.postgres_statement_timeout_ms,
            lock_timeout_ms=settings.postgres_lock_timeout_ms,
        ),
        search_path=settings.postgres_schema,
    )


def _build_tokens(settings: Settings, cache: Cache) -> TokenService:
    return TokenService(
        codec=JwtCodec(
            signing_key=settings.jwt_secret.get_secret_value(),
            verification_keys=settings.verification_keys(),
            issuer=settings.jwt_issuer,
        ),
        cache=cache,
        access_ttl_s=settings.jwt_access_ttl_s,
        refresh_ttl_s=settings.jwt_refresh_ttl_s,
    )


def _build_auth(
    settings: Settings,
    *,
    cache: Cache,
    hasher: PasswordHasher,
    tokens: TokenService,
    clock: Clock,
) -> AuthService:
    return AuthService(
        tokens=tokens,
        hasher=hasher,
        login_limiter=FixedWindowLimiter(
            cache=cache,
            namespace="login",
            limit=settings.login_max_attempts,
            window_s=settings.login_window_s,
            message="登录失败次数过多，请稍后再试",
        ),
        signup_limiter=FixedWindowLimiter(
            cache=cache,
            namespace="signup",
            limit=settings.signup_max_attempts,
            window_s=settings.signup_window_s,
        ),
        signup_enabled=settings.signup_enabled,
        signup_default_role=settings.signup_default_role,
        clock=clock,
    )


def build_container(settings: Settings, *, clock: Clock = utcnow) -> Container:
    """按配置装配容器。

    Args: settings, clock（测试注入固定时钟）。
    """
    cache = Cache(url=settings.url(), timeout_s=settings.redis_timeout_s)
    hasher = PasswordHasher()
    tokens = _build_tokens(settings, cache)
    rules = RouteRuleCache(clock=clock)
    return Container(
        settings=settings,
        database=_build_database(settings),
        cache=cache,
        hasher=hasher,
        tokens=tokens,
        auth=_build_auth(
            settings, cache=cache, hasher=hasher, tokens=tokens, clock=clock
        ),
        verify=VerifyService(
            tokens=tokens,
            rules=rules,
            signing_secret=(settings.edge_signing_secret.get_secret_value()),
            header_ttl_s=settings.edge_permission_ttl_s,
            clock=clock,
        ),
        rules=rules,
    )
