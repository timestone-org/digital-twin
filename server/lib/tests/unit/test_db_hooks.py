"""提交后副作用的登记表：跑完就清空，且单个钩子抛错不牵连其余。

⚠ 钩子跑在事务已经不可回滚之后：让一个失败的通知把已落库的写入变成 500，
是拿已经成功的事去赌一件本来就有兜底的事。
"""

from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import after_commit, run_after_commit_hooks


class FakeSession:
    """只提供 `info` 的会话替身——登记表就挂在它上面。"""

    def __init__(self) -> None:
        """一本空的登记表。"""
        self.info: dict[str, Any] = {}


def as_session(fake: FakeSession) -> AsyncSession:
    """cast 的理由：登记表只用到 `session.info`，不碰会话的其余任何一面。

    Args: fake。
    """
    return fake  # pyright: ignore[reportReturnType]


async def test_hooks_run_in_the_order_they_were_registered() -> None:
    session = FakeSession()
    seen: list[str] = []

    for name in ("first", "second"):
        after_commit(as_session(session), _record(seen, name))
    await run_after_commit_hooks(as_session(session))

    assert seen == ["first", "second"]


async def test_the_ledger_is_empty_after_a_run() -> None:
    # ⚠ 不清空的话，同一个会话上的下一次提交会把上一次的通知再发一遍
    session = FakeSession()
    seen: list[str] = []
    after_commit(as_session(session), _record(seen, "once"))

    await run_after_commit_hooks(as_session(session))
    await run_after_commit_hooks(as_session(session))

    assert seen == ["once"]


async def test_a_failing_hook_neither_escapes_nor_stops_the_rest() -> None:
    session = FakeSession()
    seen: list[str] = []
    after_commit(as_session(session), _boom)
    after_commit(as_session(session), _record(seen, "after"))

    await run_after_commit_hooks(as_session(session))

    assert seen == ["after"]


async def test_running_an_empty_ledger_is_a_no_op() -> None:
    session = FakeSession()

    await run_after_commit_hooks(as_session(session))

    assert session.info == {}


def _record(seen: list[str], name: str) -> Any:
    async def hook() -> None:
        seen.append(name)

    return hook


async def _boom() -> None:
    raise RuntimeError("通知发不出去")


@pytest.mark.parametrize("count", [1, 3])
async def test_every_registered_hook_runs(count: int) -> None:
    session = FakeSession()
    seen: list[str] = []
    for index in range(count):
        after_commit(as_session(session), _record(seen, str(index)))

    await run_after_commit_hooks(as_session(session))

    assert len(seen) == count
