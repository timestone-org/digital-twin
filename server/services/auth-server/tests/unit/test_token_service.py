"""锁住令牌轮换：刷新一次即失效，重放被拒，缓存不可达时 fail-closed。"""

import uuid

import pytest

from auth_server.apps.auth.errors import RefreshTokenRejected, TokenInvalid
from auth_server.apps.auth.services.token_service import (
    TokenService,
    parse_bearer,
)
from lib.auth import JwtCodec
from lib.errors import DependencyUnavailable
from lib.testing import InMemoryCache, UnavailableCache
from lib.utils.timeutils import utcnow

USER = uuid.UUID("00000000-0000-4000-8000-000000000001")
CODEC = JwtCodec(
    signing_key="unit-secret-0123456789abcdef-0123456789",
    verification_keys=("unit-secret-0123456789abcdef-0123456789",),
    issuer="auth",
)


def make_service(cache: object) -> TokenService:
    return TokenService(
        codec=CODEC, cache=cache, access_ttl_s=900, refresh_ttl_s=3600
    )


async def test_issued_access_token_decodes_to_the_subject() -> None:
    service = make_service(InMemoryCache())
    pair = service.issue_pair(USER, now=utcnow())
    assert service.decode_access(pair.access_token).subject == str(USER)
    assert pair.expires_in_s == 900


async def test_access_token_is_not_usable_as_refresh_token() -> None:
    service = make_service(InMemoryCache())
    pair = service.issue_pair(USER, now=utcnow())
    with pytest.raises(TokenInvalid):
        await service.consume_refresh(pair.access_token)


async def test_refresh_token_can_be_consumed_once() -> None:
    service = make_service(InMemoryCache())
    pair = service.issue_pair(USER, now=utcnow())
    assert await service.consume_refresh(pair.refresh_token) == USER


async def test_replaying_a_consumed_refresh_token_is_rejected() -> None:
    service = make_service(InMemoryCache())
    pair = service.issue_pair(USER, now=utcnow())
    await service.consume_refresh(pair.refresh_token)
    with pytest.raises(RefreshTokenRejected):
        await service.consume_refresh(pair.refresh_token)


async def test_revoked_refresh_token_is_rejected() -> None:
    service = make_service(InMemoryCache())
    pair = service.issue_pair(USER, now=utcnow())
    await service.revoke_refresh(pair.refresh_token)
    with pytest.raises(RefreshTokenRejected):
        await service.consume_refresh(pair.refresh_token)


async def test_revoking_twice_is_harmless() -> None:
    cache = InMemoryCache()
    service = make_service(cache)
    pair = service.issue_pair(USER, now=utcnow())
    await service.revoke_refresh(pair.refresh_token)
    revoked = dict(cache.store)
    await service.revoke_refresh(pair.refresh_token)
    assert cache.store == revoked


async def test_revoking_garbage_is_a_no_op_so_logout_still_succeeds() -> None:
    cache = InMemoryCache()
    await make_service(cache).revoke_refresh("not-a-token")
    assert cache.store == {}


async def test_refresh_fails_closed_when_cache_is_unreachable() -> None:
    service = make_service(UnavailableCache())
    pair = make_service(InMemoryCache()).issue_pair(USER, now=utcnow())
    with pytest.raises(DependencyUnavailable):
        await service.consume_refresh(pair.refresh_token)


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("Bearer abc", "abc"),
        ("bearer abc", "abc"),
        ("BEARER  abc ", "abc"),
        ("Basic abc", None),
        ("Bearer   ", None),
        ("", None),
        (None, None),
    ],
    ids=[
        "canonical",
        "lowercase",
        "extra-spaces",
        "wrong-scheme",
        "blank-token",
        "empty",
        "missing",
    ],
)
def test_bearer_parsing(header: str | None, expected: str | None) -> None:
    assert parse_bearer(header) == expected
