"""API 密钥的纯逻辑：明文形状、生成、可用性判定。

⚠ 本文件的第一条守的是一个只在部分密钥上复现的坑：密钥体由 `token_urlsafe`
生成，字母表里含下划线。解析时不限制切分次数，就会有一部分密钥一直认证失败，
而失败与否取决于随机字节——从现象反推不到原因。
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from auth_server.apps.auth.errors import TokenInvalid
from auth_server.apps.auth.models import KEY_TAG, ApiKey
from auth_server.apps.auth.services.api_key_service import (
    ApiKeyService,
    looks_like_api_key,
    mint_key,
    parse_api_key,
)
from lib.auth import PasswordHasher
from lib.cache import CacheLike
from lib.testing import FrozenClock, InMemoryCache, UnavailableCache

NOW = datetime(2026, 8, 14, 9, 0, tzinfo=UTC)
TOUCH_INTERVAL_S = 60

# 与种子账号同参，理由见 conftest
HASHER = PasswordHasher()


def build_service(cache: CacheLike, clock: FrozenClock) -> ApiKeyService:
    return ApiKeyService(
        hasher=HASHER,
        cache=cache,
        clock=clock,
        verify_cache_ttl_s=60,
        touch_interval_s=TOUCH_INTERVAL_S,
    )


def test_a_secret_containing_underscores_still_parses_whole() -> None:
    parsed = parse_api_key(f"{KEY_TAG}_abcd1234_head_middle_tail")
    assert parsed == ("abcd1234", "head_middle_tail")


def test_minted_keys_round_trip_through_the_parser() -> None:
    # 随机字节里迟早会出现下划线，逐个断言一批而不是一枚
    for _ in range(64):
        minted = mint_key()
        assert parse_api_key(minted.plaintext) == (
            minted.prefix,
            minted.secret,
        )


def test_minted_keys_are_never_the_same_twice() -> None:
    minted = [mint_key().plaintext for _ in range(32)]
    assert len(set(minted)) == len(minted)


def test_a_jwt_is_not_mistaken_for_a_key() -> None:
    assert not looks_like_api_key("eyJhbGciOiJIUzI1NiJ9.e30.signature")
    assert looks_like_api_key(mint_key().plaintext)


def test_malformed_plaintext_is_rejected_rather_than_guessed() -> None:
    assert parse_api_key("dtk_only-two-parts") is None
    assert parse_api_key("other_abcd1234_secret") is None
    assert parse_api_key(f"{KEY_TAG}__secret") is None
    assert parse_api_key(f"{KEY_TAG}_abcd1234_") is None


def test_a_fresh_key_without_an_expiry_stays_usable() -> None:
    key = ApiKey(name="k", prefix="p", hashed_secret="h")
    assert key.is_usable(NOW)


def test_an_expired_key_is_not_usable() -> None:
    key = ApiKey(
        name="k",
        prefix="p",
        hashed_secret="h",
        expires_at=NOW - timedelta(seconds=1),
    )
    assert not key.is_usable(NOW)
    assert key.is_usable(NOW - timedelta(days=1))


def test_a_revoked_key_is_not_usable_even_before_its_expiry() -> None:
    key = ApiKey(
        name="k",
        prefix="p",
        hashed_secret="h",
        expires_at=NOW + timedelta(days=365),
        revoked_at=NOW - timedelta(days=1),
    )
    assert not key.is_usable(NOW)


def minted_row() -> tuple[ApiKey, str]:
    """一枚在内存里的密钥与它的明文。"""
    minted = mint_key()
    row = ApiKey(
        name="k",
        prefix=minted.prefix,
        hashed_secret=HASHER.hash(minted.secret),
    )
    return row, minted.plaintext


async def test_the_second_check_of_the_same_key_skips_the_hash() -> None:
    cache = InMemoryCache()
    service = build_service(cache, FrozenClock(NOW))
    row, plaintext = minted_row()
    _, secret = parse_api_key(plaintext) or ("", "")

    await service._assert_secret(row, secret=secret, raw=plaintext)
    assert cache.store  # 首次校验把结果记了下来
    # 换掉散列：命中缓存的那条路根本不该再碰它
    row.hashed_secret = "$argon2id$不是一个能用的散列"
    await service._assert_secret(row, secret=secret, raw=plaintext)


async def test_a_wrong_secret_never_reaches_the_cached_verdict() -> None:
    cache = InMemoryCache()
    service = build_service(cache, FrozenClock(NOW))
    row, plaintext = minted_row()
    _, secret = parse_api_key(plaintext) or ("", "")
    await service._assert_secret(row, secret=secret, raw=plaintext)

    # 缓存按「明文摘要」比对，伪造的明文摘要不同，只能落到 argon2 上
    with pytest.raises(TokenInvalid):
        await service._assert_secret(row, secret="forged", raw="dtk_x_forged")


async def test_an_unreachable_cache_degrades_to_hashing_not_to_refusing() -> (
    None
):
    # ⚠ 这一层是性能件。让它 fail-closed 等于 Redis 一抖，第三方系统就全线
    # 写不进值——而那正是这枚密钥要保障的链路
    service = build_service(UnavailableCache(), FrozenClock(NOW))
    row, plaintext = minted_row()
    _, secret = parse_api_key(plaintext) or ("", "")

    await service._assert_secret(row, secret=secret, raw=plaintext)

    # 缓存挂了不等于放行：错的密钥体照样被 argon2 拦下
    with pytest.raises(TokenInvalid):
        await service._assert_secret(row, secret="forged", raw=plaintext)


async def test_an_unreachable_cache_does_not_fail_a_revocation() -> None:
    # 吊销靠的是 revoked_at 那一列，清缓存只是顺手；让它抛就等于事务回滚，
    # 表现为「点了吊销、报错、密钥还活着」
    service = build_service(UnavailableCache(), FrozenClock(NOW))
    cleared = await service._forget(uuid.uuid4())
    assert cleared is None


def test_the_used_at_stamp_is_throttled_to_one_write_per_window() -> None:
    clock = FrozenClock(NOW)
    service = build_service(InMemoryCache(), clock)
    row = ApiKey(name="k", prefix="p", hashed_secret="h")

    service._touch(row, clock.current)
    first = row.last_used_at
    assert first == NOW

    service._touch(row, clock.advance(TOUCH_INTERVAL_S - 1))
    assert row.last_used_at == first

    service._touch(row, clock.advance(2))
    assert row.last_used_at != first
