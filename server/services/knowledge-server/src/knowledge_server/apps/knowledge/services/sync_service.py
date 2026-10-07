"""来源分页与快照在事务外准备，文档和游标统一提交，失败另存安全说明。"""

import asyncio
import hashlib
import uuid
from collections.abc import Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.errors import (
    SourceNotFound,
    SourceSyncConflict,
)
from knowledge_server.apps.knowledge.schemas import SyncOut
from knowledge_server.apps.knowledge.services import document_service
from knowledge_server.apps.knowledge.services.sources import (
    DiscoveredItem,
    KnowledgeSource,
    document_key,
    source_for,
    suffix_of,
)
from lib.errors import AppError
from lib.logging import get_logger
from lib.objectstore import ObjectStore
from lib.stream import StreamGroup, StreamLike
from lib.utils.ids import uuid7
from lib.utils.timeutils import utcnow

_logger = get_logger("knowledge.sync")
MAX_PAGES = 20
Sessions = Callable[[], AbstractAsyncContextManager[AsyncSession]]


@dataclass(frozen=True)
class SyncOutcome:
    """一次来源同步的结果。"""

    registered: int
    skipped: int
    has_more: bool
    error: str = ""


@dataclass(frozen=True)
class SyncDeps:
    """来源同步的外部依赖与分页上限。"""

    sources: tuple[KnowledgeSource, ...]
    store: ObjectStore
    stream: StreamLike
    group: StreamGroup
    max_pages: int = MAX_PAGES


@dataclass(frozen=True)
class _SourceState:
    id: uuid.UUID
    base_id: uuid.UUID
    kind: str
    config: Mapping[str, object]
    cursor: str | None
    synced_at: datetime | None


@dataclass(frozen=True)
class _Batch:
    documents: tuple[crud.document.DocumentWrite, ...]
    cursor: str | None


async def _read_state(sessions: Sessions, source_id: uuid.UUID) -> _SourceState:
    async with sessions() as session:
        source = await crud.source.get_source(session, source_id)
        if source is None:
            raise SourceNotFound("这一路来源不存在")
        return _SourceState(
            source.id,
            source.base_id,
            source.kind,
            dict(source.config_json),
            source.sync_cursor,
            source.last_synced_at,
        )


def _document_write(
    source: _SourceState, item: DiscoveredItem
) -> crud.document.DocumentWrite:
    document_id = uuid7()
    key = document_key(
        source.base_id, document_id, suffix_of(item.title) or ".md"
    )
    return crud.document.DocumentWrite(
        document_id=document_id,
        base_id=source.base_id,
        source_id=source.id,
        external_ref=key,
        title=item.title,
        media_type=item.media_type,
        object_key=key,
        byte_size=item.byte_size,
        content_hash=hashlib.sha256(item.content).hexdigest(),
    )


async def _prepare(
    deps: SyncDeps, source: _SourceState, keys: list[str]
) -> _Batch:
    picked = source_for(source.kind, deps.sources)
    cursor = source.cursor
    documents: list[crud.document.DocumentWrite] = []
    for _ in range(deps.max_pages):
        page = await picked.discover(source.config, cursor)
        for item in page.items:
            write = _document_write(source, item)
            # ⚠ 写结果未知时也要核对归属，键必须在上传前登记。
            keys.append(write.object_key)
            await deps.store.put_bytes(
                write.object_key,
                item.content,
                content_type=item.media_type or "text/markdown",
            )
            documents.append(write)
        cursor = page.cursor
        if cursor is None:
            break
    return _Batch(tuple(documents), cursor)


async def _register(
    session: AsyncSession, deps: SyncDeps, write: crud.document.DocumentWrite
) -> bool:
    try:
        async with session.begin_nested():
            await crud.document.insert_document(session, write)
    except IntegrityError:
        if not await crud.document.has_content_hash(
            session, write.base_id, write.content_hash
        ):
            raise
        return False
    row = await crud.document.get_document(session, write.document_id)
    if row is None:
        raise RuntimeError("文档刚登记就取不到了")
    document_service.queue_ingest(
        session, deps.stream, deps.group, document_service.document_out(row)
    )
    return True


def _matches(
    current: crud.source.KnowledgeSource, expected: _SourceState
) -> bool:
    return (
        current.base_id,
        current.kind,
        current.config_json,
        current.sync_cursor,
        current.last_synced_at,
    ) == (
        expected.base_id,
        expected.kind,
        expected.config,
        expected.cursor,
        expected.synced_at,
    )


async def _save(
    sessions: Sessions, deps: SyncDeps, source: _SourceState, batch: _Batch
) -> SyncOutcome:
    async with sessions() as session:
        current = await crud.source.get_source(
            session, source.id, is_locked=True
        )
        if current is None:
            raise SourceNotFound("这一路来源不存在")
        if not _matches(current, source):
            raise SourceSyncConflict(
                "这一路来源的配置或同步结果已更新，请刷新后重新同步"
            )
        registered = 0
        for write in batch.documents:
            if await _register(session, deps, write):
                registered += 1
        await crud.source.mark_synced(
            session, source.id, batch.cursor, utcnow()
        )
    return SyncOutcome(
        registered, len(batch.documents) - registered, batch.cursor is not None
    )


async def _cleanup(
    sessions: Sessions, store: ObjectStore, keys: Sequence[str]
) -> None:
    if not keys:
        return
    try:
        async with sessions() as session:
            owned = await crud.document.owned_object_keys(session, keys)
    except Exception as error:
        _logger.warning(
            "sync_cleanup_unconfirmed",
            "无法核对原件归属，保留快照待清理",
            error_type=type(error).__name__,
        )
        return
    for key in keys:
        if key in owned:
            continue
        try:
            await store.delete(key)
        except Exception as error:
            _logger.warning(
                "sync_orphan_left",
                "未登记的来源原件清理失败",
                key=key,
                error_type=type(error).__name__,
            )


def _failure_reason(error: Exception | asyncio.CancelledError) -> str:
    if isinstance(error, asyncio.CancelledError):
        return "来源同步已取消，请重新同步"
    if isinstance(error, AppError):
        return error.message[:500]
    return "来源同步未完成，请稍后重新同步"


async def _finish(
    sessions: Sessions,
    deps: SyncDeps,
    source: _SourceState,
    keys: Sequence[str],
    reason: str,
) -> None:
    await _cleanup(sessions, deps.store, keys)
    if not reason:
        return
    try:
        async with sessions() as session:
            current = await crud.source.get_source(
                session, source.id, is_locked=True
            )
            if current is not None and _matches(current, source):
                await crud.source.mark_sync_failed(
                    session, source.id, reason, source.synced_at
                )
    except Exception as error:
        _logger.warning(
            "sync_failure_record_failed",
            "来源同步失败说明未能落库",
            source_id=str(source.id),
            error_type=type(error).__name__,
        )


async def _settle(
    sessions: Sessions,
    deps: SyncDeps,
    source: _SourceState,
    keys: Sequence[str],
    reason: str = "",
) -> None:
    # ⚠ 请求取消不能中断原件补偿；保留强引用并等清理任务完成。
    cleanup = asyncio.create_task(_finish(sessions, deps, source, keys, reason))
    is_cancelled = False
    while not cleanup.done():
        try:
            await asyncio.shield(cleanup)
        except asyncio.CancelledError:
            is_cancelled = True
    cleanup.result()
    if is_cancelled:
        raise asyncio.CancelledError


def sync_out(made: SyncOutcome) -> SyncOut:
    return SyncOut(
        registered=made.registered, skipped=made.skipped, has_more=made.has_more
    )


async def sync_source(
    sessions: Sessions, deps: SyncDeps, source_id: uuid.UUID
) -> SyncOutcome:
    """事务外准备原件，统一登记并补偿未提交快照。

    Args: sessions, deps, source_id。
    """
    source = await _read_state(sessions, source_id)
    keys: list[str] = []
    try:
        batch = await _prepare(deps, source, keys)
        made = await _save(sessions, deps, source, batch)
    except (Exception, asyncio.CancelledError) as error:
        await _settle(sessions, deps, source, keys, _failure_reason(error))
        raise
    await _settle(sessions, deps, source, keys)
    return made
