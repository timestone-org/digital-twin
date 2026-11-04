"""持久命令预留后在业务事务外搬运产物，回放不重复搬运。"""

from collections.abc import AsyncIterator

import pytest
from conftest import AppContext
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from integration.test_modeling_command_transactions import (
    OPERATION,
    CommittedCommands,
    Receipt,
)
from lib.db import Database
from lib.testing import FakeObjectStore
from platform_server.apps.modeling.models import (
    ModelingCommand,
    ModelingOperatorAudit,
    ModelingPipeline,
)
from platform_server.settings import Settings


class TransactionCheckingStore(FakeObjectStore):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__()
        self.session = session
        self.copies = 0

    async def copy(self, source_key: str, target_key: str) -> None:
        assert not self.session.in_transaction()
        self.copies += 1
        await super().copy(source_key, target_key)


@pytest.fixture
async def publication_fixture(
    settings: Settings,
    app_context: AppContext,
) -> AsyncIterator[CommittedCommands]:
    del app_context
    database = Database(dsn=settings.dsn(), search_path="platform")
    fixture = CommittedCommands(database)
    try:
        yield fixture
    finally:
        async with database.session() as session:
            for model in (ModelingOperatorAudit, ModelingCommand):
                await session.execute(
                    delete(model).where(
                        model.account_user_id == fixture.account
                    )
                )
            await session.execute(
                delete(ModelingPipeline).where(
                    ModelingPipeline.id.in_(fixture.pipelines)
                )
            )
        await database.dispose()


async def test_preparation_copies_outside_transaction_once_per_command(
    publication_fixture: CommittedCommands,
) -> None:
    fixture = publication_fixture
    async with fixture.database.session() as session:
        store = TransactionCheckingStore(session)
        await store.put_bytes(
            "source", b"model", content_type="application/octet-stream"
        )

        async def prepare() -> None:
            await store.copy("source", "frozen")

        first = await fixture.gate(session).run_once(
            endpoint=OPERATION,
            model=Receipt,
            action=lambda: fixture.create(session),
            prepare=prepare,
        )
    async with fixture.database.session() as session:
        replay = await fixture.gate(session).run_once(
            endpoint=OPERATION,
            model=Receipt,
            action=lambda: fixture.create(session),
            prepare=prepare,
        )
    assert replay.id == first.id
    assert store.copies == 1
    assert await store.get_bytes("frozen") == b"model"
