"""预测下发循环的单活与预算口径。

⚠ renew-or-die 少一步都不行：续不上还继续发，就是两个副本往同一个点位各写
各的，而上位机读到的值在两者之间反复横跳、两边的日志都报成功。
"""

import asyncio
import contextlib
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime

import pytest

from platform_server.apps.hvac.publications import PUBLISH_STATUS_OK
from platform_server.apps.hvac.services import (
    ac_publication_service,
    ac_publish_service,
)
from platform_server.apps.hvac.services.ac_publish_service import (
    PublishOutcome,
)
from platform_server.apps.hvac.services.ac_publish_worker import (
    PublishLoop,
    PublishLoopOptions,
)
from unit.publish_fakes import FakeLease

INTERVAL_S = 0.01
BUDGET_S = 5.0
MODEL_TIMEOUT_S = 5.0
AT = datetime(2026, 8, 15, tzinfo=UTC)


@dataclass
class SpySessions:
    """记下开过几次会话；本组用例不碰真库。

    ⚠ 计数就是断言本身：非 leader 的那一拍必须**一次都不开**——开了就说明
    我们在没有租约的时候读了库，而下一步就是写点位。
    """

    opened: int = 0

    @contextlib.asynccontextmanager
    async def session(self) -> AsyncIterator[None]:
        self.opened += 1
        yield None


@dataclass
class SpyPublisher:
    """替掉两个下发入口，记下问了什么、发了谁。"""

    ready: tuple[uuid.UUID, ...] = ()
    skipped: tuple[ac_publication_service.SkippedModel, ...] = ()
    published: list[uuid.UUID] = field(default_factory=list[uuid.UUID])
    failures: dict[uuid.UUID, Exception] = field(
        default_factory=dict[uuid.UUID, Exception]
    )

    async def due_models(
        self, _session: object
    ) -> ac_publication_service.DueModels:
        return ac_publication_service.DueModels(
            ready=self.ready, skipped=self.skipped
        )

    async def publish_once(
        self,
        _database: object,
        _reader: object,
        _nodes: object,
        *,
        model_id: uuid.UUID,
    ) -> PublishOutcome:
        self.published.append(model_id)
        failure = self.failures.get(model_id)
        if failure is not None:
            raise failure
        return PublishOutcome(
            model_id=model_id,
            status=PUBLISH_STATUS_OK,
            published_at=AT,
            items=(),
            error=None,
        )


@dataclass
class Harness:
    """一套装好的循环与它的假件。"""

    loop: PublishLoop
    lease: FakeLease
    sessions: SpySessions
    publisher: SpyPublisher


def build_harness(
    monkeypatch: pytest.MonkeyPatch,
    *,
    is_grantable: bool = True,
    is_renewable: bool = True,
    budget_s: float = BUDGET_S,
) -> Harness:
    """装一套循环，并把两个下发入口换成 spy。

    Args: monkeypatch, is_grantable, is_renewable, budget_s。
    """
    lease = FakeLease(is_grantable=is_grantable, is_renewable=is_renewable)
    sessions = SpySessions()
    publisher = SpyPublisher()
    monkeypatch.setattr(
        ac_publication_service, "due_models", publisher.due_models
    )
    monkeypatch.setattr(
        ac_publish_service, "publish_once", publisher.publish_once
    )
    # 假件都满足被替代者的最小面，运行期按结构用
    loop = PublishLoop(
        database=sessions,  # type: ignore[arg-type]  # 测试假件
        lease=lease,  # type: ignore[arg-type]  # 测试假件
        reader=None,  # type: ignore[arg-type]  # spy 不会用到它
        nodes=None,  # type: ignore[arg-type]  # 同上
        options=PublishLoopOptions(
            interval_s=INTERVAL_S,
            budget_s=budget_s,
            model_timeout_s=MODEL_TIMEOUT_S,
        ),
    )
    return Harness(
        loop=loop, lease=lease, sessions=sessions, publisher=publisher
    )


async def test_a_tick_without_the_lease_never_touches_the_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """抢不到租约就什么都不做——连库都不读。

    ⚠ 读了库就意味着下一步会写点位，而此刻别的副本正在写同一批。
    """
    harness = build_harness(monkeypatch, is_grantable=False)
    await harness.loop.tick()
    assert harness.loop.is_leader is False
    assert harness.sessions.opened == 0
    assert harness.publisher.published == []


async def test_losing_the_lease_stops_publishing_at_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """续不上租约立刻判非 leader，这一拍就地收手。"""
    harness = build_harness(monkeypatch, is_renewable=False)
    harness.publisher.ready = (uuid.uuid4(),)
    await harness.loop.tick()
    assert harness.loop.is_leader is True
    assert len(harness.publisher.published) == 1
    await harness.loop.tick()
    assert harness.loop.is_leader is False
    # 第二拍一个都没发：续不上就地收手
    assert len(harness.publisher.published) == 1


async def test_releasing_hands_the_lease_back_only_when_held(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """没持有就不让位——让位会删掉接任者的租约。"""
    harness = build_harness(monkeypatch, is_grantable=False)
    await harness.loop.release()
    assert "release" not in harness.lease.ledger
    granted = build_harness(monkeypatch)
    await granted.loop.tick()
    await granted.loop.release()
    assert "release" in granted.lease.ledger
    assert granted.loop.is_leader is False


async def test_every_ready_model_gets_published_in_one_tick(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """预算够用时，该发的一个都不落。"""
    harness = build_harness(monkeypatch)
    wanted = (uuid.uuid4(), uuid.uuid4(), uuid.uuid4())
    harness.publisher.ready = wanted
    await harness.loop.tick()
    assert harness.publisher.published == list(wanted)


async def test_one_failing_model_does_not_stop_the_rest_of_the_tick(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """一个模型炸了，同一拍里其余的照发。

    ⚠ 不隔开的话，一个房间没绑数据源就能让全厂的点位一起停在旧值。
    """
    harness = build_harness(monkeypatch)
    doomed, healthy = uuid.uuid4(), uuid.uuid4()
    harness.publisher.ready = (doomed, healthy)
    harness.publisher.failures[doomed] = RuntimeError("这个模型炸了")
    await harness.loop.tick()
    assert harness.publisher.published == [doomed, healthy]


async def test_a_spent_budget_stops_the_tick_instead_of_running_over(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """预算用完就收手，不把这一拍拖进下一拍。

    ⚠ 跑过头会让下一拍从一开始就迟到，而迟到会累积。
    """
    harness = build_harness(monkeypatch, budget_s=0.0)
    harness.publisher.ready = (uuid.uuid4(), uuid.uuid4())
    await harness.loop.tick()
    assert harness.publisher.published == []


async def test_a_failing_tick_does_not_kill_the_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """一拍出错不许带走整个循环——带走了就再也不续租约，而进程还活着。"""
    harness = build_harness(monkeypatch)
    ticks = 0

    async def exploding() -> None:
        nonlocal ticks
        ticks += 1
        if ticks >= 2:
            harness.loop.stop()
        raise RuntimeError("这一拍炸了")

    harness.loop.tick = exploding  # type: ignore[method-assign]  # 测试注入
    await asyncio.wait_for(harness.loop.run(), timeout=2)
    assert ticks >= 2
