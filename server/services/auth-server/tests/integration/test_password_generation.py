"""登录和修改口令的数据库事务与刷新代次。"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.pool import AsyncAdaptedQueuePool

from auth_server.app import build_app
from auth_server.apps.auth.crud import role_crud
from auth_server.apps.auth.errors import (
    CurrentPasswordIncorrect,
    InvalidCredentials,
)
from auth_server.apps.auth.models import User
from auth_server.apps.auth.schemas import ChangePasswordIn
from auth_server.apps.auth.services.bounded_hasher import BoundedHasher
from auth_server.container import Container
from auth_server.settings import API_PREFIX
from lib.ratelimit import FixedWindowLimiter
from lib.testing import deferred_commit_failure

pytestmark = [
    pytest.mark.requires_postgres,
    pytest.mark.usefixtures("_database_required"),
]
INITIAL = "InitialTestPass902"
CHANGED = "ChangedTestPass902"
LATE = "LaterTestPass902"


@pytest.fixture
async def account(container: Container) -> AsyncIterator[UUID]:
    name = f"generation-{uuid4().hex[:12]}"
    encoded = await container.hasher.hash(INITIAL)
    async with container.database.session() as session:
        role = await role_crud.get_by_name(session, "viewer")
        assert role is not None
        row = User(
            username=name,
            email=name + "@example.test",
            hashed_password=encoded,
            role_id=role.id,
        )
        session.add(row)
        await session.flush()
        account_id = row.id
    try:
        yield account_id
    finally:
        async with container.database.session() as session:
            await session.execute(delete(User).where(User.id == account_id))


async def test_already_verified_password_cannot_replace_a_concurrent_reset(
    container: Container, account: UUID
) -> None:
    async with container.database.session() as older:
        old = await older.get(User, account)
        assert old is not None
        async with container.database.session() as newer:
            current = await newer.get(User, account)
            assert current is not None
            await container.auth.change_password(
                newer,
                user=current,
                payload=ChangePasswordIn(
                    current_password=INITIAL, new_password=CHANGED
                ),
            )
        with pytest.raises(CurrentPasswordIncorrect):
            await container.auth.change_password(
                older,
                user=old,
                payload=ChangePasswordIn(
                    current_password=INITIAL, new_password=LATE
                ),
            )


async def test_rehash_preserves_the_refresh_generation(
    container: Container, account: UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with container.database.session() as session:
        user = await session.get(User, account)
        assert user is not None
        await container.auth.change_password(
            session,
            user=user,
            payload=ChangePasswordIn(
                current_password=INITIAL, new_password=CHANGED
            ),
        )
        generation = user.refresh_generation
        assert generation is not None
        issued = container.tokens.issue_pair(user.id, generation=generation)
        name = user.username
    monkeypatch.setattr(BoundedHasher, "needs_rehash", lambda *_: True)
    await container.auth.login(
        container.database.session, login=name, password=CHANGED
    )
    async with container.database.session() as session:
        refreshed = await container.auth.refresh(
            session, refresh_token=issued.refresh_token
        )
        assert refreshed.user.id == account


async def _concurrent_update(
    container: Container, account: UUID, name: str, update: str
) -> None:
    """提交与登录凭据核对交错的操作。Args: container, account, name, update。"""
    if update == "concurrent_rehash":
        await container.auth.login(
            container.database.session, login=name, password=INITIAL
        )
        return
    async with container.database.session() as session:
        current = await session.get(User, account)
        assert current is not None
        if update == "legacy_reset":
            current.hashed_password = await container.hasher.hash(CHANGED)
        else:
            await container.auth.change_password(
                session,
                user=current,
                payload=ChangePasswordIn(
                    current_password=INITIAL, new_password=CHANGED
                ),
            )


@pytest.mark.parametrize(
    "update",
    ["reset", "reset_during_rehash", "concurrent_rehash", "legacy_reset"],
)
async def test_login_rechecks_concurrent_credential_updates(
    container: Container,
    account: UUID,
    monkeypatch: pytest.MonkeyPatch,
    update: str,
) -> None:
    checked, resume = asyncio.Event(), asyncio.Event()
    verify = BoundedHasher.verify

    async def delayed(
        hasher: BoundedHasher, password: str, encoded: str
    ) -> bool:
        valid = await verify(hasher, password, encoded)
        if valid and password == INITIAL and not checked.is_set():
            checked.set()
            await asyncio.wait_for(resume.wait(), timeout=10)
        return valid

    monkeypatch.setattr(BoundedHasher, "verify", delayed)
    monkeypatch.setattr(
        BoundedHasher,
        "needs_rehash",
        lambda *_: update in {"reset_during_rehash", "concurrent_rehash"},
    )
    async with container.database.session() as session:
        user = await session.get(User, account)
        assert user is not None
        name = user.username

    async def login() -> None:
        await container.auth.login(
            container.database.session, login=name, password=INITIAL
        )

    task = asyncio.create_task(login())
    try:
        await asyncio.wait_for(checked.wait(), timeout=10)
        await _concurrent_update(container, account, name, update)
    finally:
        resume.set()
    if update == "concurrent_rehash":
        await task
    else:
        with pytest.raises(InvalidCredentials):
            await task


async def test_login_releases_the_connection_for_hashes_and_cache(
    container: Container,
    account: UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with container.database.session() as session:
        user = await session.get(User, account)
        assert user is not None
        login = user.username
    pool = container.database.engine.sync_engine.pool
    assert isinstance(pool, AsyncAdaptedQueuePool)
    observed: list[tuple[str, int]] = []
    original_verify, original_hash = BoundedHasher.verify, BoundedHasher.hash
    original_reset = FixedWindowLimiter.reset

    async def verify(
        hasher: BoundedHasher, password: str, encoded: str
    ) -> bool:
        observed.append(("verify", pool.checkedout()))
        return await original_verify(hasher, password, encoded)

    async def rehash(hasher: BoundedHasher, password: str) -> str:
        observed.append(("hash", pool.checkedout()))
        return await original_hash(hasher, password)

    async def reset(limiter: FixedWindowLimiter, key: str) -> None:
        observed.append(("reset", pool.checkedout()))
        await original_reset(limiter, key)

    monkeypatch.setattr(BoundedHasher, "verify", verify)
    monkeypatch.setattr(BoundedHasher, "hash", rehash)
    monkeypatch.setattr(BoundedHasher, "needs_rehash", lambda *_: True)
    monkeypatch.setattr(FixedWindowLimiter, "reset", reset)
    application = build_app(container.settings)
    application.state.container = container
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application),
        base_url="http://auth-test",
    ) as client:
        response = await client.post(
            f"{API_PREFIX}/sessions",
            json={"username": login, "password": INITIAL},
        )
    assert response.status_code == 201
    assert response.json()["data"]["user"]["id"] == str(account)
    assert {kind for kind, _ in observed} == {"verify", "hash", "reset"}
    assert all(count == 0 for _, count in observed), observed


async def test_login_requires_a_committed_success_record(
    container: Container,
    account: UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    open_session = container.database.session
    async with open_session() as session:
        user = await session.get(User, account)
        assert user is not None
        payload = {"username": user.username, "password": INITIAL}

    reset_keys: list[str] = []

    async def reset(_limiter: FixedWindowLimiter, key: str) -> None:
        reset_keys.append(key)

    reads_remaining = 1

    @asynccontextmanager
    async def fail_record_commit() -> AsyncIterator[AsyncSession]:
        nonlocal reads_remaining
        factory = (
            open_session
            if reads_remaining
            else deferred_commit_failure(open_session)
        )
        reads_remaining -= 1
        async with factory() as session:
            yield session

    application = build_app(container.settings)
    application.state.container = container
    transport = httpx.ASGITransport(app=application, raise_app_exceptions=False)
    monkeypatch.setattr(FixedWindowLimiter, "reset", reset)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://auth-test"
    ) as client:
        with monkeypatch.context() as patch:
            patch.setattr(container.database, "session", fail_record_commit)
            rejected = await client.post(f"{API_PREFIX}/sessions", json=payload)
        assert rejected.status_code == 500
        assert rejected.json()["trace_id"]
        assert not reset_keys
        async with open_session() as session:
            user = await session.get(User, account)
            assert user is not None
            assert user.last_login_at is None
