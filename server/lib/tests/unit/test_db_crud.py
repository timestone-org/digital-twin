"""锁住通用 CRUD 的契约：分页与计数同口径、排序走白名单、**从不提交**。

⚠ 这一层用 aiosqlite 跑（testing-standard-python.md §6.3 允许 L1 这么做）：
它验的是 CRUD 自己的逻辑，不验方言相关的行为——那些归 L2 的真实 Postgres。
"""

import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import String, select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import CrudBase, UuidPrimaryKeyMixin, make_declarative_base
from lib.errors.base import ValidationFailed

# SQLite 没有 schema 的概念，给空串让建表语句不带前缀
Base = make_declarative_base("")


class Note(Base, UuidPrimaryKeyMixin):  # type: ignore[misc]  # 声明基类由工厂动态造出，pyright 看不到它是类
    __tablename__ = "notes"

    title: Mapped[str] = mapped_column(String(64), nullable=False)
    body: Mapped[str] = mapped_column(String(64), nullable=False, default="")


notes = CrudBase(Note)


@pytest.fixture
async def session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as opened:
        yield opened
    await engine.dispose()


async def seed(session: AsyncSession, *titles: str) -> list[Note]:
    rows = [Note(title=title) for title in titles]
    for row in rows:
        notes.add(session, row)
    await session.flush()
    return rows


async def test_add_then_flush_gives_an_id_without_committing(
    session: AsyncSession,
) -> None:
    # ⚠ 要 id 用 flush 不用 commit：提前提交会把一次逻辑操作切成两个事务
    row = notes.add(session, Note(title="a"))
    await session.flush()
    assert isinstance(row.id, uuid.UUID)
    assert session.in_transaction()


async def test_get_returns_the_row_by_primary_key(
    session: AsyncSession,
) -> None:
    [row] = await seed(session, "a")
    assert await notes.get(session, row.id) is row


async def test_get_returns_none_for_an_unknown_id(
    session: AsyncSession,
) -> None:
    assert await notes.get(session, uuid.uuid4()) is None


async def test_delete_removes_the_row(session: AsyncSession) -> None:
    [row] = await seed(session, "a")
    await notes.delete(session, row)
    await session.flush()
    assert await notes.get(session, row.id) is None


async def test_list_page_reports_the_total_of_the_whole_filter(
    session: AsyncSession,
) -> None:
    await seed(session, "a", "b", "c")
    rows, total = await notes.list_page(
        session, statement=select(Note), offset=0, limit=2
    )
    # ⚠ total 必须是过滤后的全量，不是本页条数——否则分页器只显示一页
    assert (len(rows), total) == (2, 3)


async def test_list_page_offset_walks_the_rest(session: AsyncSession) -> None:
    await seed(session, "a", "b", "c")
    rows, _ = await notes.list_page(
        session, statement=select(Note), offset=2, limit=2
    )
    assert len(rows) == 1


async def test_count_ignores_order_by_so_it_can_reuse_the_statement(
    session: AsyncSession,
) -> None:
    await seed(session, "a", "b")
    statement = select(Note).order_by(Note.title.desc())
    assert await notes.count(session, statement=statement) == 2


async def test_apply_changes_assigns_each_named_field() -> None:
    row = Note(title="a", body="x")
    notes.apply_changes(row, {"title": "b", "body": "y"})
    assert (row.title, row.body) == ("b", "y")


async def test_order_by_whitelist_falls_back_to_the_default(
    session: AsyncSession,
) -> None:
    await seed(session, "b", "a")
    statement = notes.order_by_whitelist(
        select(Note), sort=None, allowed={}, default=(Note.title.asc(),)
    )
    rows = (await session.execute(statement)).scalars().all()
    assert [row.title for row in rows] == ["a", "b"]


async def test_order_by_whitelist_honours_the_minus_prefix(
    session: AsyncSession,
) -> None:
    await seed(session, "a", "b")
    statement = notes.order_by_whitelist(
        select(Note),
        sort="-title",
        allowed={"title": Note.title},
        default=(Note.title.asc(),),
    )
    rows = (await session.execute(statement)).scalars().all()
    assert [row.title for row in rows] == ["b", "a"]


async def test_order_by_whitelist_accepts_several_columns(
    session: AsyncSession,
) -> None:
    await seed(session, "a", "b")
    statement = notes.order_by_whitelist(
        select(Note),
        sort="body, -title",
        allowed={"title": Note.title, "body": Note.body},
        default=(),
    )
    rows = (await session.execute(statement)).scalars().all()
    assert [row.title for row in rows] == ["b", "a"]


def test_order_by_whitelist_rejects_a_field_outside_the_list() -> None:
    # ⚠ 白名单之外直接 400：它既是注入面，也是让人不小心对无索引列排序的入口
    with pytest.raises(ValidationFailed) as caught:
        notes.order_by_whitelist(
            select(Note), sort="password", allowed={}, default=()
        )
    assert caught.value.details[0].field == "sort"
    assert caught.value.details[0].code == "unsupported_sort_field"
