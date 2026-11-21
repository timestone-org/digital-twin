"""确认回滚与无法确认的提交需要不同的幂等回执。"""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy.exc import DBAPIError, PendingRollbackError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import commit_before_receipt
from lib.db.commit import CommitOutcomeUnknown


class _DatabaseReply(Exception):
    def __init__(self, sqlstate: str) -> None:
        super().__init__(sqlstate)
        self.sqlstate = sqlstate


@pytest.mark.parametrize("code", ["23505", "40001", "40P01"])
async def test_database_reported_abort_remains_a_confirmed_rejection(
    code: str,
) -> None:
    error = DBAPIError(None, None, _DatabaseReply(code))
    session = AsyncMock(spec=AsyncSession)
    session.commit.side_effect = error
    with pytest.raises(DBAPIError) as caught:
        await commit_before_receipt(session)
    assert caught.value is error


async def test_already_aborted_session_never_reaches_commit() -> None:
    session = AsyncMock(spec=AsyncSession)
    error = PendingRollbackError("already aborted")
    session.commit.side_effect = error
    with pytest.raises(PendingRollbackError) as caught:
        await commit_before_receipt(session)
    assert caught.value is error


@pytest.mark.parametrize(
    "error",
    [
        TimeoutError(),
        DBAPIError(None, None, _DatabaseReply("40003")),
        DBAPIError(None, None, _DatabaseReply("08007")),
        DBAPIError(
            None, None, _DatabaseReply("23505"), connection_invalidated=True
        ),
    ],
)
async def test_unknown_commit_acknowledgement_preserves_the_key(
    error: Exception,
) -> None:
    session = AsyncMock(spec=AsyncSession)
    session.commit.side_effect = error
    with pytest.raises(CommitOutcomeUnknown, match="提交结果未确认") as caught:
        await commit_before_receipt(session)
    assert caught.value.is_outcome_unknown
    assert not caught.value.is_retryable
    assert caught.value.__cause__ is error
