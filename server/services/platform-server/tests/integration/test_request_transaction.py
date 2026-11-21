"""在 HTTP 成功和幂等成功回执之前确认平台请求事务。"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, replace

import httpx
import pytest
from conftest import SignHeaders
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from integration.dataset_helpers import TABLES
from lib.db import Database
from lib.idempotency import IdempotencyStore
from lib.testing import InMemoryCache, deferred_commit_failure
from platform_server.app import build_app
from platform_server.apps.dataset.crud import table_crud
from platform_server.container import Container
from platform_server.settings import Settings

pytestmark = pytest.mark.requires_postgres


@dataclass(frozen=True)
class TransactionFixture:
    client: httpx.AsyncClient
    database: Database
    code: str

    async def stored_name(self) -> str | None:
        async with self.database.session() as session:
            row = await table_crud.get_by_code(session, self.code)
            return row.name if row is not None else None

    async def create(
        self, name: str, *, should_send_key: bool = False
    ) -> httpx.Response:
        return await self.client.post(
            TABLES,
            json={"code": self.code, "name": name},
            headers={"Idempotency-Key": self.code} if should_send_key else {},
        )


@pytest.fixture
async def transaction_client(
    settings: Settings, db_session: AsyncSession, sign: SignHeaders
) -> AsyncIterator[TransactionFixture]:
    del db_session
    app = build_app(settings)
    container = app.state.container
    assert isinstance(container, Container)
    app.state.container = replace(
        container,
        idempotency=IdempotencyStore(
            cache=InMemoryCache(), namespace="platform-transaction-test"
        ),
    )
    database = container.database
    code = f"commit_{uuid.uuid4().hex[:12]}"
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    try:
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers=sign(),
            timeout=10,
        ) as client:
            yield TransactionFixture(client, database, code)
    finally:
        async with database.session() as session:
            row = await table_crud.get_by_code(session, code)
            if row is not None:
                await session.delete(row)
        await database.dispose()


@pytest.mark.parametrize(
    "has_key", [False, True], ids=["ordinary", "idempotent"]
)
async def test_commit_rejection_reports_failure_and_allows_the_same_key(
    transaction_client: TransactionFixture,
    monkeypatch: pytest.MonkeyPatch,
    has_key: bool,
) -> None:
    fixture = transaction_client
    original = fixture.database.session
    with monkeypatch.context() as patch:
        patch.setattr(
            fixture.database, "session", deferred_commit_failure(original)
        )
        failed = await fixture.create("提交时回滚", should_send_key=has_key)
    assert await fixture.stored_name() is None
    assert failed.status_code == 500, failed.text
    assert failed.json()["trace_id"]

    corrected = await fixture.create("实际保存", should_send_key=has_key)
    assert corrected.status_code == 201, corrected.text
    assert await fixture.stored_name() == "实际保存"
    if has_key:
        replay = await fixture.create("实际保存", should_send_key=True)
        assert replay.status_code == 201
        assert replay.json()["data"]["id"] == corrected.json()["data"]["id"]


async def test_lost_commit_acknowledgement_preserves_idempotency_claim(
    transaction_client: TransactionFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = transaction_client
    original = fixture.database.session

    @asynccontextmanager
    async def disconnect_after_commit() -> AsyncIterator[AsyncSession]:
        async with original() as session:
            commit = session.commit

            async def lose_acknowledgement() -> None:
                await commit()
                raise DBAPIError(
                    "COMMIT",
                    None,
                    ConnectionResetError("QA lost commit acknowledgement"),
                    connection_invalidated=True,
                )

            monkeypatch.setattr(session, "commit", lose_acknowledgement)
            yield session

    with monkeypatch.context() as patch:
        patch.setattr(fixture.database, "session", disconnect_after_commit)
        uncertain = await fixture.create("实际已经提交", should_send_key=True)
    assert await fixture.stored_name() == "实际已经提交"
    assert uncertain.status_code == 503, uncertain.text
    assert "未确认" in uncertain.json()["message"]

    repeated = await fixture.create("不应再次执行", should_send_key=True)
    assert repeated.status_code == 409, repeated.text
    assert "未确认" in repeated.json()["message"]
    assert await fixture.stored_name() == "实际已经提交"
