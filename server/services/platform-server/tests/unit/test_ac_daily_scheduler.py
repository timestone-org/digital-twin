"""日增量调度器的用例：入队失败的那一天不许被记成已投。"""

import uuid
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from lib.errors import DependencyUnavailable
from lib.stream import StreamGroup, StreamLike
from platform_server.apps.hvac.services import (
    ac_daily_queue,
    ac_daily_worker,
)
from platform_server.apps.hvac.services.ac_daily_worker import (
    DailyScheduler,
    SchedulerOptions,
)
from platform_server.lease import Lease

ROOM_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
NOW = datetime(2026, 3, 2, 4, 0, tzinfo=UTC)


@dataclass
class FakeDatabase:
    """只提供 `session()` 的假库。"""

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        yield cast(AsyncSession, object())


@dataclass
class AlwaysLeader:
    """永远抢得到、续得上的租约。"""

    async def acquire(self) -> bool:
        return True

    async def renew(self) -> bool:
        return True

    async def release(self) -> None:
        return None

    async def close(self) -> None:
        return None


@dataclass
class FlakyPublish:
    """第一次投递失败、之后成功，并记下每次投的是哪一天。"""

    days: list[date] = field(default_factory=list[date])

    async def __call__(
        self,
        _stream: object,
        *,
        target: StreamGroup,
        messages: Sequence[ac_daily_queue.DailyMessage],
    ) -> list[str]:
        assert target.group == "g"
        self.days.extend(message.business_date for message in messages)
        if len(self.days) == 1:
            raise DependencyUnavailable("队列暂时不可用")
        return [str(day) for day in self.days]


async def test_a_failed_enqueue_is_retried_on_the_next_tick(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 入队失败时这一天不能记成已投，否则它就永久丢了。"""

    async def rooms(_session: object) -> list[uuid.UUID]:
        return [ROOM_ID]

    publish = FlakyPublish()
    monkeypatch.setattr(ac_daily_worker, "rooms_with_current_batch", rooms)
    monkeypatch.setattr(ac_daily_queue, "publish_daily", publish)
    monkeypatch.setattr(ac_daily_worker, "utcnow", lambda: NOW)
    scheduler = DailyScheduler(
        database=cast(Database, FakeDatabase()),
        stream=cast(StreamLike, object()),
        lease=cast(Lease, AlwaysLeader()),
        options=SchedulerOptions(
            target=StreamGroup(stream="s", group="g", consumer="c"),
            interval_s=0.01,
            timezone="Asia/Shanghai",
        ),
    )
    with pytest.raises(DependencyUnavailable):
        await scheduler.tick()
    await scheduler.tick()
    assert publish.days == [date(2026, 3, 1), date(2026, 3, 1)]
