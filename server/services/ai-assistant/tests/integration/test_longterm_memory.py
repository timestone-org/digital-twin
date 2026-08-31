"""长期记忆的仓储，打真库（ADR-0030）。

⚠ 这里守的是本模块**唯一的安全条款**：助手代表用户行事，绝不能让 A 用户记的
东西被 B 检索到。过滤写在仓储层而不是调用点——写在调用点的话，下一个调用点漏掉
它不会报错，只会多召回几条别人的，而那种事没有任何一处会亮红灯。

⚠ 另一条守的是降级：嵌入当时算不出来的条目**仍然落库**，由下一次检索惰性补算。
丢掉比记不全更坏，而「记住了但永远查不到」是最坏的一种。
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ai_assistant.apps.chat.services.memory.longterm import PgLongTermStore
from ai_assistant.apps.chat.services.memory.ports import Knowledge
from integration.conftest import DbStack

ALICE = "11111111-1111-4111-8111-111111111111"
BOB = "22222222-2222-4222-8222-222222222222"


@dataclass
class FakeEmbedder:
    """按文本长度造一条可预测的向量；`is_broken` 为真时这一次算不出来。"""

    dimensions: int = 3
    is_broken: bool = False
    id: str = "fake"
    calls: list[int] = field(default_factory=list[int])

    async def embed(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(len(texts))
        if self.is_broken:
            raise RuntimeError("端点挂了")
        return [[float(len(one)), 1.0, 0.0] for one in texts]


def _sessions(
    maker: async_sessionmaker[AsyncSession],
) -> object:
    """把用例那条连接包成与生产同语义的会话工厂。

    ⚠ 裸的 `async_sessionmaker()` **只关不提交**，而生产那条 `Database.session`
    是「正常出块提交、异常回滚」。直接拿裸的当工厂用的话，写进去的行一条都不落，
    而现象是「记住了但查不到」——与真实的降级路径长得一模一样，最难分辨。
    """

    @asynccontextmanager
    async def one() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise
            else:
                await session.commit()

    return one


def _store(stack: DbStack, embedder: FakeEmbedder) -> PgLongTermStore:
    return PgLongTermStore(
        sessions=_sessions(stack.sessions), embedder=embedder
    )


async def test_one_owner_never_sees_what_another_remembered(
    db_stack: DbStack,
) -> None:
    """两个身份各记一条，互相检索必须为空。这是本模块唯一的安全条款。"""
    store = _store(db_stack, FakeEmbedder())
    await store.remember(
        Knowledge(scope="user", owner_id=ALICE, title="甲", body="甲的口径")
    )
    await store.remember(
        Knowledge(scope="user", owner_id=BOB, title="乙", body="乙的口径")
    )

    mine = await store.search("口径", "user", ALICE, 10)
    yours = await store.search("口径", "user", BOB, 10)

    assert [one.title for one in mine] == ["甲"]
    assert [one.title for one in yours] == ["乙"]


async def test_a_different_scope_is_a_different_shelf(
    db_stack: DbStack,
) -> None:
    """同一个人的两档归属互不串台：`scope` 与 `owner_id` 一起做键。"""
    store = _store(db_stack, FakeEmbedder())
    await store.remember(
        Knowledge(scope="user", owner_id=ALICE, title="偏好", body="我的")
    )
    await store.remember(
        Knowledge(scope="project", owner_id=ALICE, title="口径", body="项目的")
    )

    found = await store.search("的", "user", ALICE, 10)

    assert [one.title for one in found] == ["偏好"]


async def test_a_failed_embedding_still_writes_the_text(
    db_stack: DbStack,
) -> None:
    """丢掉比记不全更坏：算不出向量也要把用户说的那句话存下来。"""
    store = _store(db_stack, FakeEmbedder(is_broken=True))

    found = await store.remember(
        Knowledge(scope="user", owner_id=ALICE, title="口径", body="正文")
    )

    assert found


async def test_the_next_search_backfills_what_the_embedder_missed(
    db_stack: DbStack,
) -> None:
    """补救走惰性补算，不另建一条关键词召回——两条召回路径迟早给出不同结果。"""
    broken = FakeEmbedder(is_broken=True)
    await _store(db_stack, broken).remember(
        Knowledge(scope="user", owner_id=ALICE, title="口径", body="正文")
    )

    healthy = FakeEmbedder()
    found = await _store(db_stack, healthy).search("正文", "user", ALICE, 10)

    assert [one.title for one in found] == ["口径"]


async def test_searching_without_an_embedder_comes_back_empty(
    db_stack: DbStack,
) -> None:
    """没接嵌入档时排不了序。⚠ 这与「没记过」是两件事，由工具层如实说清。"""
    await _store(db_stack, FakeEmbedder()).remember(
        Knowledge(scope="user", owner_id=ALICE, title="口径", body="正文")
    )

    blind = PgLongTermStore(
        sessions=_sessions(db_stack.sessions), embedder=None
    )

    assert await blind.search("正文", "user", ALICE, 10) == []
    assert blind.can_rank is False
