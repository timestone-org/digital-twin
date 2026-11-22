"""记录正常本机外部读请求开始时仍占用连接的平台事务。"""

from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session, SessionTransaction


@contextmanager
def observe_read(
    patch: pytest.MonkeyPatch,
    target: object,
    method: str,
    before: Callable[[], Awaitable[None]] | None = None,
) -> Iterator[list[int]]:
    """在外部读开始时观察事务。Args: patch, target, method, before。"""
    owned: set[Session] = set()
    counts: list[int] = []
    original = getattr(target, method)

    def opened(
        session: Session, _transaction: SessionTransaction, _connection: object
    ) -> None:
        owned.add(session)

    def ended(session: Session, transaction: SessionTransaction) -> None:
        if transaction.parent is None:
            owned.discard(session)

    async def read(*args: object, **kwargs: object) -> Any:
        counts.append(len(owned))
        if before is not None:
            await before()
        return await original(*args, **kwargs)

    event.listen(Session, "after_begin", opened)
    event.listen(Session, "after_transaction_end", ended)
    try:
        with patch.context() as hook:
            hook.setattr(target, method, read)
            yield counts
    finally:
        event.remove(Session, "after_begin", opened)
        event.remove(Session, "after_transaction_end", ended)
