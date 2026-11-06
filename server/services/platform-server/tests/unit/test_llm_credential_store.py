"""登录态那一层里不碰库的几条。

守的是「一路供应商只许有一行」与「账号标识只留尾巴」——两条都是出了事才看得见
的：两行表现为「换了账号却没生效」，账号全量回给前端则是白白多摊了一份 PII。
"""

import datetime as dt
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, cast

import pytest

from lib.crypto import SecretCipher
from lib.testing import InMemoryCache
from platform_server.apps.llm_providers import crud
from platform_server.apps.llm_providers.errors import (
    LlmCredentialStale,
    LlmLoginRejected,
    LlmLoginUpstreamUnavailable,
)
from platform_server.apps.llm_providers.models import LlmProviderCredential
from platform_server.apps.llm_providers.services.credential_store import (
    CredentialStore,
    masked,
)
from platform_server.apps.llm_providers.services.tokens import TokenBundle

PROVIDER = uuid.UUID("0192f0aa-0000-7000-8000-000000000003")
LOCK_KEY = f"llm-credential-refresh:{PROVIDER}"
CIPHER = SecretCipher("k" * 32, label="test")


def bundle(refresh_token: str, *, is_stale: bool) -> TokenBundle:
    lifetime = dt.timedelta(hours=-1 if is_stale else 1)
    return TokenBundle(
        access_token=f"access-of-{refresh_token}",
        refresh_token=refresh_token,
        expires_at=dt.datetime.now(dt.UTC) + lifetime,
    )


@dataclass
class FakeOAuth:
    """记下拿哪张 refresh_token 换过；可选地按给定的错误失败。"""

    error: Exception | None = None
    used: list[str] = field(default_factory=list[str])

    async def refresh(self, refresh_token: str) -> TokenBundle:
        self.used.append(refresh_token)
        if self.error is not None:
            raise self.error
        return bundle(f"{refresh_token}-next", is_stale=False)


@dataclass
class RacingCache(InMemoryCache):
    """抢到锁的那一刻，库里已经被上一位持锁人写成了 `rotated`。"""

    row: Any = None
    rotated: TokenBundle | None = None

    async def set_if_absent(self, key: str, value: str, *, ttl_s: int) -> bool:
        if self.rotated is not None:
            self.row.token_enc = self.rotated.to_cipher_text(CIPHER)
        return await super().set_if_absent(key, value, ttl_s=ttl_s)


@asynccontextmanager
async def _session() -> AsyncGenerator[Any]:
    yield object()


def build_store(
    monkeypatch: pytest.MonkeyPatch,
    *,
    oauth: FakeOAuth,
    rotated: TokenBundle | None = None,
) -> tuple[CredentialStore, RacingCache]:
    """库里躺着一份过期令牌包的登录态读写面。"""
    row = LlmProviderCredential(
        provider_id=PROVIDER,
        token_enc=bundle("old", is_stale=True).to_cipher_text(CIPHER),
        row_version=1,
    )

    async def found(_session: object, _provider_id: uuid.UUID) -> Any:
        return row

    monkeypatch.setattr(crud.credential, "by_provider", found)
    monkeypatch.setattr(crud.credential, "by_provider_for_update", found)
    cache = RacingCache(row=row, rotated=rotated)
    store = CredentialStore(
        sessions=_session,
        cipher=CIPHER,
        oauth=cast(Any, oauth),
        cache=cast(Any, cache),
    )
    return store, cache


async def test_a_refresh_someone_else_finished_is_not_repeated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    oauth = FakeOAuth()
    store, cache = build_store(
        monkeypatch, oauth=oauth, rotated=bundle("rotated", is_stale=False)
    )

    leased = await store.lease(PROVIDER)

    # ⚠ 拿已作废的 refresh_token 再刷一次，上游会拒，好好的登录被标成失效
    assert oauth.used == []
    assert leased.access_token == "access-of-rotated"
    assert LOCK_KEY not in cache.store


async def test_a_refresh_uses_the_token_read_under_the_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    oauth = FakeOAuth()
    store, _ = build_store(
        monkeypatch, oauth=oauth, rotated=bundle("rotated", is_stale=True)
    )

    await store.lease(PROVIDER)

    assert oauth.used == ["rotated"]


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (LlmLoginUpstreamUnavailable("连不上"), LlmLoginUpstreamUnavailable),
        (LlmLoginRejected("作废了"), LlmCredentialStale),
    ],
)
async def test_a_failed_refresh_lets_go_of_the_lock(
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected: type[Exception],
) -> None:
    store, cache = build_store(monkeypatch, oauth=FakeOAuth(error=error))

    with pytest.raises(expected):
        await store.lease(PROVIDER)

    # ⚠ 锁留满 TTL 的话，上游恢复后这十几秒里所有人仍拿回过期令牌
    assert LOCK_KEY not in cache.store


def test_a_credential_row_belongs_to_one_provider_only() -> None:
    # 同一路两行的话，读到哪一行取决于排序，而「换了账号却没生效」最难查
    unique = {
        column.name
        for constraint in LlmProviderCredential.__table__.constraints
        for column in getattr(constraint, "columns", [])
        if constraint.__class__.__name__ == "UniqueConstraint"
    }
    assert "provider_id" in unique


def test_the_login_dies_with_the_provider_row() -> None:
    # 留着的话，下一个建出来的供应商可能撞上一行没人认领的登录态
    rules = {
        key.ondelete
        for key in LlmProviderCredential.__table__.foreign_key_constraints
    }
    assert rules == {"CASCADE"}


def test_an_account_label_keeps_only_its_tail() -> None:
    assert masked("acct_1234567890") == "…567890"
    # 本来就短的话不必再截，截了反而看不出是哪个号
    assert masked("abc") == "abc"
    assert masked(None) is None
    assert masked("") is None
