"""回合落库的序号分配：同一对话的两个回合并发落库都留得下。"""

import asyncio
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import cast

from langchain_core.messages import AIMessage, HumanMessage
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ClauseElement

from knowledge_server.apps.chat.models import ChatMessage
from knowledge_server.apps.chat.services.advance_persist import (
    TurnRecord,
    persist,
)
from llmcore.turn import TurnOutcome

CHAT = uuid.UUID("00000000-0000-7000-8000-000000000001")


class _Database:
    """已提交的消息行、会话行锁与 `(session_id, seq)` 唯一键。"""

    def __init__(self) -> None:
        self.committed: list[ChatMessage] = []
        self.row_lock = asyncio.Lock()

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession]:
        opened = _Transaction(self)
        try:
            yield cast("AsyncSession", opened)
            await asyncio.sleep(0)
            opened.commit()
        finally:
            if opened.holds_lock:
                self.row_lock.release()


class _Transaction:
    """一个事务：读已提交，写在提交时才碰唯一键。"""

    def __init__(self, database: _Database) -> None:
        self.database = database
        self.pending: list[ChatMessage] = []
        self.holds_lock = False

    async def execute(self, statement: ClauseElement) -> SimpleNamespace:
        text = str(statement.compile(dialect=postgresql.dialect()))
        if "FOR UPDATE" in text:
            await self.database.row_lock.acquire()
            self.holds_lock = True
        await asyncio.sleep(0)
        rows = list(self.database.committed)
        found = SimpleNamespace(all=lambda: rows)
        return SimpleNamespace(scalars=lambda: found)

    def add(self, row: ChatMessage) -> None:
        self.pending.append(row)

    async def flush(self) -> None:
        await asyncio.sleep(0)

    def commit(self) -> None:
        taken = {row.seq for row in self.database.committed}
        for row in self.pending:
            if row.seq in taken:
                raise IntegrityError("insert", {}, Exception("唯一键冲突"))
        self.database.committed.extend(self.pending)


def _turn(question: str) -> TurnRecord:
    return TurnRecord(
        incoming=[HumanMessage(content=question)],
        outcome=TurnOutcome(messages=[AIMessage(content="好")]),
        steps=[],
    )


async def test_two_concurrent_turns_are_both_kept_in_order() -> None:
    """⚠ 撞唯一键的那一轮模型已经答完，却整轮不落库，而且流上没有 error 帧。"""
    database = _Database()

    await asyncio.gather(
        persist(database.session, chat_session_id=CHAT, record=_turn("甲")),
        persist(database.session, chat_session_id=CHAT, record=_turn("乙")),
    )

    assert sorted(row.seq for row in database.committed) == [1, 2, 3, 4]
