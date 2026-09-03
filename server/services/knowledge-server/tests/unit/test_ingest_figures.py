"""摄取管线里「存图」那一段：字节上哪去、同一张图怎么合、块与图怎么连。

⚠ 落库那一步在这一份里是假的：真行为已经由 `integration/test_figures.py`
钉住了，这一份钉的是**落库之前**那几件事——键怎么拼、失败怎么翻、去重与
联结的编号。两份合起来才是这条路的全貌。
"""

import uuid
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from typing import Any

import pytest

from knowledge_server.apps.knowledge.crud.figure import FigureWrite
from knowledge_server.apps.knowledge.services import ingest_figures
from knowledge_server.apps.knowledge.services.chunking import Chunk
from knowledge_server.apps.knowledge.services.parsing import (
    Figure,
    ParsedDocument,
)
from lib.objectstore import ObjectStoreError

BASE = uuid.UUID("00000000-0000-7000-8000-000000000001")
DOCUMENT = uuid.UUID("00000000-0000-7000-8000-000000000002")


class _Store:
    """记下每一次放件；也能被叫着当场失败。"""

    def __init__(self, *, should_fail: bool = False) -> None:
        self.objects: dict[str, bytes] = {}
        self.types: dict[str, str] = {}
        self.should_fail = should_fail

    async def put_bytes(
        self, key: str, content: bytes, *, content_type: str
    ) -> None:
        if self.should_fail:
            raise ObjectStoreError("桶不理人")
        self.objects[key] = content
        self.types[key] = content_type


@asynccontextmanager
async def _no_session() -> AsyncIterator[None]:
    """一个不连库的事务口子；这一份里落库那一步是打桩的。"""
    yield None


def _sessions() -> Any:
    return _no_session


def _figure(ref: str, content: bytes, **rest: Any) -> Figure:
    return Figure(
        ref=ref,
        content=content,
        media_type=rest.pop("media_type", "image/png"),
        **rest,
    )


def _parsed(*figures: Figure) -> ParsedDocument:
    return ParsedDocument(title="a.pdf", blocks=(), figures=figures)


@pytest.fixture
def written(monkeypatch: pytest.MonkeyPatch) -> list[Sequence[FigureWrite]]:
    """截住落库那一步，把要落的行留下来。"""
    seen: list[Sequence[FigureWrite]] = []

    async def _replace(
        session: object,
        base_id: uuid.UUID,
        document_id: uuid.UUID,
        rows: Sequence[FigureWrite],
    ) -> dict[str, uuid.UUID]:
        del session, base_id, document_id
        seen.append(rows)
        return {one.content_hash: uuid.uuid4() for one in rows}

    monkeypatch.setattr(ingest_figures.crud.figure, "replace_figures", _replace)
    return seen


async def test_a_document_without_figures_never_touches_the_store(
    written: list[Sequence[FigureWrite]],
) -> None:
    """⚠ 没图就直接回空：走下去会白开一个事务，而摄取的每一份文档都走这一段。"""
    store = _Store()
    made = await ingest_figures.store_figures(
        _sessions(), store, (BASE, DOCUMENT), _parsed()
    )
    assert made == {}
    assert store.objects == {}
    assert written == []


@pytest.mark.usefixtures("written")
async def test_the_key_is_the_content_hash_not_the_ordinal() -> None:
    """⚠ 键用内容哈希：序号会随切分变化而漂，于是重新解析一次就在桶里留下
    一串孤儿；哈希不会漂，重解算出同一个键。"""
    store = _Store()
    await ingest_figures.store_figures(
        _sessions(), store, (BASE, DOCUMENT), _parsed(_figure("r1", b"png"))
    )
    digest = ingest_figures.hashed(b"png")
    key = next(iter(store.objects))
    assert digest in key
    assert key.startswith(f"knowledge/{BASE}/{DOCUMENT}/figures/")
    assert store.objects[key] == b"png"
    assert store.types[key] == "image/png"


@pytest.mark.parametrize(
    ("media_type", "suffix"),
    [
        ("image/jpeg", ".jpg"),
        ("image/png", ".png"),
        ("image/webp", ".webp"),
        ("image/tiff", ".bin"),
    ],
)
@pytest.mark.usefixtures("written")
async def test_the_suffix_comes_from_a_whitelist(
    media_type: str, suffix: str
) -> None:
    """⚠ 白名单：media type 是外部解析后端给的，拿它直接拼后缀等于让外部决定
    对象键的形状。认不出的给 `.bin` 而不是空串——桶里一堆无后缀对象在运维
    手里就是一团看不出是什么的东西。"""
    store = _Store()
    await ingest_figures.store_figures(
        _sessions(),
        store,
        (BASE, DOCUMENT),
        _parsed(_figure("r1", b"x", media_type=media_type)),
    )
    assert next(iter(store.objects)).endswith(suffix)


async def test_the_same_image_twice_lands_as_one_row(
    written: list[Sequence[FigureWrite]],
) -> None:
    """⚠ 不去重会撞 `(document_id, content_hash)` 那条唯一键，而那一撞会让
    整份文档摄取失败——每页都有的图框正是这么来的。"""
    store = _Store()
    made = await ingest_figures.store_figures(
        _sessions(),
        store,
        (BASE, DOCUMENT),
        _parsed(_figure("r1", b"same"), _figure("r2", b"same")),
    )
    rows = written[0]
    assert len(rows) == 1
    assert [one.ordinal for one in rows] == [0]
    # ⚠ 两个 ref 都要指到那一行：块引的是 ref，合掉的那一个不能跟着消失
    assert set(made) == {"r1", "r2"}
    assert made["r1"] == made["r2"]


async def test_the_ordinals_are_renumbered_after_dedupe(
    written: list[Sequence[FigureWrite]],
) -> None:
    """⚠ 合掉一行之后序号要重排：留着空档的话「第 2 张图」在界面上数不出来。"""
    store = _Store()
    await ingest_figures.store_figures(
        _sessions(),
        store,
        (BASE, DOCUMENT),
        _parsed(_figure("r1", b"a"), _figure("r2", b"a"), _figure("r3", b"b")),
    )
    assert [one.ordinal for one in written[0]] == [0, 1]


async def test_the_bbox_is_flattened_into_named_corners(
    written: list[Sequence[FigureWrite]],
) -> None:
    """⚠ 摊成有名字的四个角而不是存一个四元组：读的那一头分不清 `x1` 是右边
    还是宽度，而两种口径都有人用。"""
    store = _Store()
    await ingest_figures.store_figures(
        _sessions(),
        store,
        (BASE, DOCUMENT),
        _parsed(_figure("r1", b"a", bbox=(10, 20, 30, 40), page=3)),
    )
    row = written[0][0]
    assert row.bbox == {"x0": 10, "y0": 20, "x1": 30, "y1": 40}
    assert row.page == 3


async def test_a_figure_without_a_bbox_stores_an_empty_object(
    written: list[Sequence[FigureWrite]],
) -> None:
    """⚠ 拿不到版面框给空对象而不是 null：读的那一头少一次判空。"""
    store = _Store()
    await ingest_figures.store_figures(
        _sessions(), store, (BASE, DOCUMENT), _parsed(_figure("r1", b"a"))
    )
    assert written[0][0].bbox == {}


async def test_a_store_that_refuses_fails_the_whole_document(
    written: list[Sequence[FigureWrite]],
) -> None:
    """⚠ 存不上就整份判失败，不「少存一张继续走」：少了的那张在引用面上是一个
    取不到的图，而那与「这一段本来没有图」看起来一模一样。"""
    with pytest.raises(ingest_figures.FigureStoreFailed):
        await ingest_figures.store_figures(
            _sessions(),
            _Store(should_fail=True),
            (BASE, DOCUMENT),
            _parsed(_figure("r1", b"a")),
        )
    assert written == []


def _chunk(*refs: str) -> Chunk:
    return Chunk(
        ordinal=0,
        text="正文",
        heading_path=(),
        token_count=2,
        figure_refs=refs,
    )


def test_links_number_the_figures_within_each_chunk() -> None:
    """⚠ 编号是**块内**的：跨块连着编的话，删掉一块会让后面每一块的编号都变。"""
    first, second = uuid.uuid4(), uuid.uuid4()
    one, two = uuid.uuid4(), uuid.uuid4()
    made = ingest_figures.links_of(
        [_chunk("a", "b"), _chunk("a")],
        [first, second],
        {"a": one, "b": two},
    )
    assert made == [(first, one, 0), (first, two, 1), (second, one, 0)]


def test_a_ref_with_no_bytes_behind_it_is_skipped() -> None:
    """⚠ 认不出的 ref 跳过而不是抛：解析后端可能给了一个没有对应字节的引用，
    为它整份判失败会把一份好文档挡在外面。"""
    chunk_id, figure_id = uuid.uuid4(), uuid.uuid4()
    made = ingest_figures.links_of(
        [_chunk("gone", "here")], [chunk_id], {"here": figure_id}
    )
    assert made == [(chunk_id, figure_id, 0)]


def test_a_chunk_without_figures_makes_no_links() -> None:
    made = ingest_figures.links_of([_chunk()], [uuid.uuid4()], {})
    assert made == []
