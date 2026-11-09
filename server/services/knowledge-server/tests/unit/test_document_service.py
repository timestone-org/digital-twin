"""文档服务里不碰库的那几步：格式与大小的闸、直传凭证、哈希与挪件。"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.errors import (
    DuplicateDocument,
    ObjectStoreDown,
    UnsupportedRawItem,
    UploadNotFound,
)
from knowledge_server.apps.knowledge.schemas import (
    RegisterDocumentIn,
    UploadTicketIn,
)
from knowledge_server.apps.knowledge.services import document_service
from knowledge_server.apps.knowledge.services.sources import (
    document_key,
    preview_key,
    staging_key,
)
from knowledge_server.settings import MAX_RAW_BYTES
from lib.objectstore import (
    ObjectNotFound,
    ObjectStore,
    ObjectStoreUnavailable,
    PresignedPost,
    UploadLimits,
)

BASE = uuid.UUID("00000000-0000-7000-8000-000000000001")
DOC = uuid.UUID("00000000-0000-7000-8000-000000000002")


class _Store:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.copied: list[tuple[str, str]] = []
        self.deleted: list[str] = []
        self.limits: UploadLimits | None = None
        self.ttl: int = 0

    async def presign_post(
        self,
        key: str,
        *,
        content_type: str,
        limits: UploadLimits,
        ttl_s: int,
    ) -> PresignedPost:
        del content_type
        self.limits = limits
        self.ttl = ttl_s
        return PresignedPost(
            url="http://store",
            fields={"key": key},
            key=key,
            expires_seconds=ttl_s,
        )

    async def get_bytes(self, key: str) -> bytes:
        try:
            return self.objects[key]
        except KeyError as error:
            raise ObjectNotFound(key) from error

    async def copy(self, source_key: str, target_key: str) -> None:
        self.copied.append((source_key, target_key))
        self.objects[target_key] = self.objects[source_key]

    async def delete(self, key: str) -> None:
        self.deleted.append(key)
        self.objects.pop(key, None)


def _ticket(filename: str, size: int = 10) -> UploadTicketIn:
    return UploadTicketIn(filename=filename, size_bytes=size)


async def test_a_ticket_encodes_the_document_id_into_the_key() -> None:
    """⚠ id 在签凭证那一步就铸好并编进对象键：登记那一步只认这个键，
    客户端没法把字节传到一个 id 下、再拿另一个 id 来登记。"""
    store = _Store()
    made = await document_service.presign_upload(
        store,  # pyright: ignore[reportArgumentType]
        BASE,
        _ticket("手册.md"),
        (),
    )
    assert str(made.document_id) in made.object_key
    assert str(BASE) in made.object_key
    assert made.object_key.endswith(".md")


async def test_the_size_limit_is_signed_into_the_policy() -> None:
    """⚠ 大小闸签进 policy 由存储端强制，不靠前端自觉：只在前端拦的话，
    一次直连存储的请求就能绕过去。"""
    store = _Store()
    await document_service.presign_upload(
        store,  # pyright: ignore[reportArgumentType]
        BASE,
        _ticket("手册.md"),
        (),
    )
    assert store.limits is not None
    assert store.limits.max_bytes == MAX_RAW_BYTES
    assert store.limits.min_bytes >= 1


async def test_a_zero_byte_file_is_refused_by_the_policy() -> None:
    """⚠ 最小字节数不是 0：一份 0 字节的文件传得上去、解出来是空的、状态却是
    ready，而那与「这份文档里确实没这句话」长得一模一样。"""
    store = _Store()
    await document_service.presign_upload(
        store,  # pyright: ignore[reportArgumentType]
        BASE,
        _ticket("手册.md"),
        (),
    )
    assert store.limits is not None
    assert store.limits.min_bytes > 0


@pytest.mark.parametrize("filename", ["图纸.pdf", "没有后缀", "a.exe"])
async def test_an_unsupported_format_is_refused_before_signing(
    filename: str,
) -> None:
    with pytest.raises(UnsupportedRawItem):
        await document_service.presign_upload(
            _Store(),  # pyright: ignore[reportArgumentType]
            BASE,
            _ticket(filename),
            (),
        )


async def test_a_file_over_the_limit_is_refused_before_signing() -> None:
    """⚠ 在签凭证那一步就拒：签出去之后再拒，用户已经把字节传上来了。"""
    with pytest.raises(UnsupportedRawItem, match="超过上限"):
        await document_service.presign_upload(
            _Store(),  # pyright: ignore[reportArgumentType]
            BASE,
            _ticket("手册.md", MAX_RAW_BYTES + 1),
            (),
        )


async def test_the_hash_is_computed_on_our_side() -> None:
    """⚠ 客户端报什么我们就存什么的话，去重就成了一句空话——两份不同内容
    报同一个哈希，第二份会被当成重复丢掉。"""
    store = _Store()
    store.objects["staging"] = b"hello"
    digest, size = await document_service._hashed(
        store,  # pyright: ignore[reportArgumentType]
        "staging",
    )
    assert size == 5
    assert len(digest) == 64


async def test_the_same_bytes_always_hash_the_same() -> None:
    store = _Store()
    store.objects["a"] = b"same"
    store.objects["b"] = b"same"
    first, _ = await document_service._hashed(
        store,  # pyright: ignore[reportArgumentType]
        "a",
    )
    second, _ = await document_service._hashed(
        store,  # pyright: ignore[reportArgumentType]
        "b",
    )
    assert first == second


class _StuckDeleteStore(_Store):
    """删除总是瞬时失败的对象存储。"""

    async def delete(self, key: str) -> None:
        raise ObjectStoreUnavailable(key)


def _registration(
    monkeypatch: pytest.MonkeyPatch,
    *,
    is_duplicate: bool,
    is_registered: bool = False,
) -> None:
    """替换登记走到的库操作；重复时唯一键与判重查询口径一致。

    Args: monkeypatch, is_duplicate, is_registered（这个 id 已经登记过了）。
    """
    inserted: list[bool] = [is_registered]

    async def source(*_args: object) -> SimpleNamespace:
        return SimpleNamespace(id=uuid.uuid4())

    async def has_hash(*_args: object) -> bool:
        return is_duplicate

    async def insert(*_args: object) -> None:
        if is_duplicate:
            raise IntegrityError("insert", {}, Exception("唯一键冲突"))
        inserted[0] = True

    async def row(*_args: object) -> SimpleNamespace | None:
        if not inserted[0]:
            return None
        return SimpleNamespace(
            id=DOC,
            base_id=BASE,
            source_id=uuid.uuid4(),
            title="手册.md",
            media_type="",
            byte_size=5,
            status="pending",
            failure_reason="",
            chunk_count=0,
            object_key="final",
            created_at=datetime.now(UTC),
            ready_at=None,
        )

    monkeypatch.setattr(crud.source, "find_source_by_kind", source)
    monkeypatch.setattr(crud.document, "has_content_hash", has_hash)
    monkeypatch.setattr(crud.document, "insert_document", insert)
    monkeypatch.setattr(crud.document, "get_document", row)


class _Session:
    """只记「此刻有没有开着事务」的假数据库会话。

    ⚠ 开局就开着：路由在调登记之前已经查过库，请求那个事务早就开了。
    """

    def __init__(self) -> None:
        self.is_open = True

    def in_transaction(self) -> bool:
        return self.is_open

    async def commit(self) -> None:
        self.is_open = False


class _WatchingStore(_Store):
    """每次碰对象存储时记下数据库事务是不是还开着。"""

    def __init__(self, session: _Session) -> None:
        super().__init__()
        self.session = session
        self.open_during_io: list[bool] = []

    async def get_bytes(self, key: str) -> bytes:
        self.open_during_io.append(self.session.in_transaction())
        return await super().get_bytes(key)

    async def copy(self, source_key: str, target_key: str) -> None:
        self.open_during_io.append(self.session.in_transaction())
        await super().copy(source_key, target_key)


async def _register(store: _Store, session: _Session | None = None) -> str:
    made = await document_service.register_upload(
        cast("AsyncSession", session or _Session()),
        cast("ObjectStore", store),
        BASE,
        RegisterDocumentIn(document_id=DOC, filename="手册.md"),
        (),
    )
    return made.title


async def test_a_duplicate_leaves_no_bytes_behind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 重复传 N 次的界面提示是对的，而桶里会多出 N 份没人引用的原件。"""
    _registration(monkeypatch, is_duplicate=True)
    store = _Store()
    store.objects[staging_key(BASE, DOC, ".md")] = b"hello"

    with pytest.raises(DuplicateDocument):
        await _register(store)

    assert store.objects == {}


async def test_a_registration_moves_the_bytes_out_of_staging(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 挪完不删暂存的话，每次登记都在桶里多留一份没人引用的原件。"""
    _registration(monkeypatch, is_duplicate=False)
    store = _Store()
    staging = staging_key(BASE, DOC, ".md")
    final = document_key(BASE, DOC, ".md")
    store.objects[staging] = b"hello"

    assert await _register(store) == "手册.md"

    assert store.objects == {final: b"hello"}
    assert store.copied == [(staging, final)]
    assert store.deleted == [staging]


async def test_a_failed_staging_delete_does_not_fail_the_registration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 字节已经挪好，留下的暂存件只是没人引用，不该给用户一个 5xx。"""
    _registration(monkeypatch, is_duplicate=False)
    store = _StuckDeleteStore()
    store.objects[staging_key(BASE, DOC, ".md")] = b"hello"

    assert await _register(store) == "手册.md"
    assert document_key(BASE, DOC, ".md") in store.objects


async def test_no_transaction_stays_open_across_the_object_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 读几十兆原件与挪件都是跨网络的外部 IO：事务开着跨过去，几次并发的
    大文件登记就能把连接池占满（database-standard：事务里禁止外部 IO）。"""
    _registration(monkeypatch, is_duplicate=False)
    session = _Session()
    store = _WatchingStore(session)
    store.objects[staging_key(BASE, DOC, ".md")] = b"hello"

    await _register(store, session)

    assert store.open_during_io == [False, False]


async def test_registering_before_the_bytes_landed_is_a_4xx(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 直传没落地、凭证过期或那一步 POST 失败时，回的得是「请重新上传」，
    而不是一条 500 加一段 ERROR 堆栈。"""
    _registration(monkeypatch, is_duplicate=False)

    with pytest.raises(UploadNotFound) as caught:
        await _register(_Store())

    assert caught.value.http_status == 409


async def test_registering_the_same_id_twice_is_a_conflict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 连点一次「确认上传」：第一次已把暂存件挪走，第二次不该是 500。"""
    _registration(monkeypatch, is_duplicate=False, is_registered=True)

    with pytest.raises(DuplicateDocument, match="登记过"):
        await _register(_Store())


class _DownStore(_Store):
    """签不出凭证的对象存储。"""

    async def presign_post(
        self,
        key: str,
        *,
        content_type: str,
        limits: UploadLimits,
        ttl_s: int,
    ) -> PresignedPost:
        del content_type, limits, ttl_s
        raise ObjectStoreUnavailable(key)


async def test_a_store_outage_while_signing_is_a_503() -> None:
    with pytest.raises(ObjectStoreDown) as caught:
        await document_service.presign_upload(
            _DownStore(),  # pyright: ignore[reportArgumentType]
            BASE,
            _ticket("手册.md"),
            (),
        )
    assert caught.value.http_status == 503


@dataclass(frozen=True)
class _Document:
    """预览读取只需要的文档行字段。"""

    id: uuid.UUID = DOC
    base_id: uuid.UUID = BASE
    title: str = "系统图.docx"
    object_key: str = f"knowledge/{BASE}/{DOC}.docx"
    content_hash: str = "a" * 64


def _document(monkeypatch: pytest.MonkeyPatch) -> None:
    async def read(_session: object, _document_id: uuid.UUID) -> _Document:
        return _Document()

    monkeypatch.setattr(document_service, "read_document", read)


async def test_preview_prefers_the_pdf_derivative(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _document(monkeypatch)
    store = _Store()
    pdf = b"%PDF-1.7\nshape"
    store.objects[preview_key(BASE, DOC)] = pdf

    made = await document_service.read_preview(
        None, store, DOC  # pyright: ignore[reportArgumentType]
    )

    assert made.content == pdf
    assert made.media_type == "application/pdf"
    assert made.filename == "系统图.pdf"
    assert made.is_fallback is False


async def test_preview_falls_back_to_the_original_without_a_derivative(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _document(monkeypatch)
    store = _Store()
    store.objects[_Document().object_key] = b"docx"

    made = await document_service.read_preview(
        None, store, DOC  # pyright: ignore[reportArgumentType]
    )

    assert made.content == b"docx"
    assert made.media_type.endswith("wordprocessingml.document")
    assert made.is_fallback is True


async def test_the_derivative_preview_endpoint_only_accepts_docx(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def read(_session: object, _document_id: uuid.UUID) -> _Document:
        return _Document(
            title="规程.md", object_key=f"knowledge/{BASE}/{DOC}.md"
        )

    monkeypatch.setattr(document_service, "read_document", read)
    with pytest.raises(UnsupportedRawItem, match="DOCX"):
        await document_service.read_preview(
            None, _Store(), DOC  # pyright: ignore[reportArgumentType]
        )
