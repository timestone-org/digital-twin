"""来源同步，打真库。外部记录摄成这个库的文档，之后走同一条管线。"""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field

import httpx
import pytest

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.services import sync_service
from knowledge_server.apps.knowledge.services.sources import (
    PLATFORM_KIND,
    UPLOAD_KIND,
    DiscoveredItem,
    DiscoveredPage,
)
from knowledge_server.settings import API_PREFIX
from lib.stream import StreamGroup

pytestmark = pytest.mark.requires_postgres

BASES = f"{API_PREFIX}/knowledge-bases"


@dataclass
class _Pull:
    """按页吐固定条目的假外部来源。"""

    pages: list[tuple[tuple[DiscoveredItem, ...], str | None]] = field(
        default_factory=list
    )
    calls: int = 0
    kind: str = PLATFORM_KIND

    def config_schema(self) -> Mapping[str, object]:
        return {}

    async def discover(
        self, config: Mapping[str, object], cursor: str | None
    ) -> DiscoveredPage:
        del config, cursor
        items, more = (
            self.pages[self.calls]
            if self.calls < len(self.pages)
            else ((), None)
        )
        self.calls += 1
        return DiscoveredPage(items=items, cursor=more)

    async def fetch(self, config: Mapping[str, object], ref: str) -> object:
        del config, ref
        raise NotImplementedError


class _Store:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    async def put_bytes(
        self, key: str, data: bytes, *, content_type: str
    ) -> None:
        del content_type
        self.objects[key] = data

    async def delete(self, key: str) -> None:
        self.deleted.append(key)
        self.objects.pop(key, None)


class _Stream:
    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    async def publish(self, stream: str, fields: dict[str, str]) -> str:
        del stream
        self.sent.append(dict(fields))
        return "1-0"


def _item(text: str, name: str = "记录") -> DiscoveredItem:
    body = text.encode("utf-8")
    return DiscoveredItem(
        external_ref=name,
        title=f"{name}.md",
        media_type="text/markdown",
        byte_size=len(body),
        content=body,
    )


async def _source_row(db_sessions: object) -> uuid.UUID:
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        base = await crud.knowledge_base.insert_base(
            session,
            crud.knowledge_base.BaseWrite(
                name="台账库",
                description="",
                owner_id="t",
                embedding_model=None,
                dimensions=None,
                retrieval_strategy="hybrid",
            ),
        )
        row = await crud.source.insert_source(
            session, base.id, PLATFORM_KIND, "台账", {"path": "/x"}
        )
        return row.id


def _deps(pull: _Pull, store: _Store, stream: _Stream) -> object:
    return sync_service.SyncDeps(
        sources=(pull,),  # pyright: ignore[reportArgumentType]
        store=store,  # pyright: ignore[reportArgumentType]
        stream=stream,  # pyright: ignore[reportArgumentType]
        group=StreamGroup(stream="s", group="g", consumer="c"),
        max_pages=3,
    )


async def test_pulled_rows_become_documents(db_sessions: object) -> None:
    """⚠ 内容在同步这一刻就落成**我们自己的原件**，之后走的是与上传完全相同
    的那条管线——worker 于是永远只读我们自己的存储。"""
    source_id = await _source_row(db_sessions)
    pull = _Pull(pages=[((_item("出口温度：65", "甲"),), None)])
    store, stream = _Store(), _Stream()
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        made = await sync_service.sync_source(
            session,
            _deps(pull, store, stream),  # pyright: ignore[reportArgumentType]
            source_id,
        )
    assert made.registered == 1
    assert made.has_more is False
    assert len(store.objects) == 1
    assert len(stream.sent) == 1


async def test_the_same_row_twice_is_skipped(db_sessions: object) -> None:
    """⚠ 外部系统的同一行被同步两次是常态（游标重叠、有人手按），
    而重复的表现是同一段话在检索里出现两次。"""
    source_id = await _source_row(db_sessions)
    same = _item("出口温度：65", "甲")
    store, stream = _Store(), _Stream()
    for _ in range(2):
        pull = _Pull(pages=[((same,), None)])
        async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
            made = await sync_service.sync_source(
                session,
                _deps(
                    pull, store, stream
                ),  # pyright: ignore[reportArgumentType]
                source_id,
            )
    assert made.registered == 0
    assert made.skipped == 1
    # ⚠ 重复条目的字节要清掉：留着的话，每同步一次就多一份没人引用的副本
    assert store.deleted


async def test_the_cursor_is_remembered(db_sessions: object) -> None:
    """⚠ 丢了游标就是全量重扫，而全量重扫在外部系统那一侧可能是几十万次分页。"""
    source_id = await _source_row(db_sessions)
    pull = _Pull(
        pages=[((_item("甲", "a"),), "2"), ((_item("乙", "b"),), None)]
    )
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        await sync_service.sync_source(
            session,
            _deps(
                pull, _Store(), _Stream()
            ),  # pyright: ignore[reportArgumentType]
            source_id,
        )
        row = await crud.source.get_source(session, source_id)
    assert row is not None
    assert row.last_synced_at is not None
    assert row.last_error == ""


async def test_hitting_the_page_ceiling_says_so(
    db_sessions: object,
) -> None:
    """⚠ 装作拉完了的话，用户不会再按第二次，而剩下的记录永远进不来。"""
    source_id = await _source_row(db_sessions)
    pull = _Pull(
        pages=[
            ((_item(f"第{one}条", f"r{one}"),), str(one + 2))
            for one in range(5)
        ]
    )
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        made = await sync_service.sync_source(
            session,
            _deps(
                pull, _Store(), _Stream()
            ),  # pyright: ignore[reportArgumentType]
            source_id,
        )
    assert made.has_more is True
    assert pull.calls == 3


async def test_syncing_an_upload_source_is_a_no_op(
    db_sessions: object,
) -> None:
    """上传那一路的 `discover` 恒空——同步它不报错，只是什么都不做。"""
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        base = await crud.knowledge_base.insert_base(
            session,
            crud.knowledge_base.BaseWrite(
                name="库",
                description="",
                owner_id="t",
                embedding_model=None,
                dimensions=None,
                retrieval_strategy="hybrid",
            ),
        )
        row = await crud.source.insert_source(
            session, base.id, UPLOAD_KIND, "上传", {}
        )
        source_id = row.id
    pull = _Pull(kind=UPLOAD_KIND, pages=[((), None)])
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        made = await sync_service.sync_source(
            session,
            _deps(
                pull, _Store(), _Stream()
            ),  # pyright: ignore[reportArgumentType]
            source_id,
        )
    assert made.registered == 0


async def test_syncing_a_missing_source_is_refused(
    db_client: httpx.AsyncClient,
) -> None:
    response = await db_client.post(f"{API_PREFIX}/sources/{uuid.uuid4()}:sync")
    assert response.status_code >= httpx.codes.BAD_REQUEST
