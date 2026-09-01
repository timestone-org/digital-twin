"""跑一次来源同步：把外部系统的记录摄成这个库的文档。

⚠ 同步**在用户按下那一刻、用用户自己的身份**跑（api 角色）。不存任何凭据：
存了的话，一次配置泄露等于把那个人的权限交出去，而无人值守的 worker 会拿着
它不停地读。

⚠ 一次调用**有页数上限**。没有上限的话，一个几十万行的外部表会把这一次请求
拖上几十分钟——而请求超时之后，已经登记的那些文档还在，游标却没存下来。
到顶就把游标存好并如实回「还有更多」，由人（或界面）再按一次。

⚠ 内容在同步这一刻就落成**我们自己的原件**（写进对象存储），之后走的是与
上传完全相同的那条管线。这样 worker 永远只读我们自己的存储：它跑起来时那个
用户早就走了，再去打外部系统就只能用服务级密钥——而那正是「知识库当越权通道」
的开端。
"""

import hashlib
import uuid
from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.errors import SourceNotFound
from knowledge_server.apps.knowledge.schemas import SyncOut
from knowledge_server.apps.knowledge.services import document_service
from knowledge_server.apps.knowledge.services.sources import (
    DiscoveredItem,
    KnowledgeSource,
    document_key,
    source_for,
    suffix_of,
)
from lib.logging import get_logger
from lib.objectstore import ObjectStore, ObjectStoreError
from lib.stream import StreamGroup, StreamLike
from lib.utils.ids import uuid7
from lib.utils.timeutils import utcnow

_logger = get_logger("knowledge.sync")

# 一次同步最多拉几页
MAX_PAGES = 20


@dataclass(frozen=True)
class SyncOutcome:
    """一次同步的结果。"""

    registered: int
    skipped: int
    has_more: bool
    error: str = ""


@dataclass(frozen=True)
class SyncDeps:
    """跑一次同步要的那几样。

    ⚠ 打成一包而不是逐个形参：调用面的形参上限是 5。
    """

    sources: tuple[KnowledgeSource, ...]
    store: ObjectStore
    stream: StreamLike
    group: StreamGroup
    max_pages: int = MAX_PAGES


async def _stored(
    store: ObjectStore,
    base_id: uuid.UUID,
    document_id: uuid.UUID,
    item: DiscoveredItem,
) -> str:
    """把一条外部记录落成我们自己的原件，回它的对象键。

    Args: store, base_id, document_id, item。
    """
    key = document_key(base_id, document_id, suffix_of(item.title) or ".md")
    await store.put_bytes(
        key, item.content, content_type=item.media_type or "text/markdown"
    )
    return key


async def _registered(
    session: AsyncSession,
    deps: SyncDeps,
    source: crud.source.KnowledgeSource,
    item: DiscoveredItem,
) -> bool:
    """登记一条；内容重复就跳过，回它有没有真的登记进去。

    ⚠ 重复靠 `(base_id, content_hash)` 那条唯一键拦住——外部系统的同一行被
    同步两次是常态（游标重叠、有人手按），而重复的表现是同一段话在检索里
    出现两次。

    Args: session, deps, source, item。
    """
    document_id = uuid7()
    digest = hashlib.sha256(item.content).hexdigest()
    key = await _stored(deps.store, source.base_id, document_id, item)
    try:
        # ⚠ 圈一个保存点：撞唯一键之后那一次 flush 已经失败，不回滚的话整个
        # 会话被毒住——同一批里后面每一条都会撞上一句
        # 「transaction has been rolled back」，而真正的原因是第一条重复
        async with session.begin_nested():
            await crud.document.insert_document(
                session,
                crud.document.DocumentWrite(
                    document_id=document_id,
                    base_id=source.base_id,
                    source_id=source.id,
                    external_ref=key,
                    title=item.title,
                    media_type=item.media_type,
                    object_key=key,
                    byte_size=item.byte_size,
                    content_hash=digest,
                ),
            )
    except IntegrityError:
        # ⚠ 撞唯一键就是「这一条已经在库里了」，不是错误。顺手把刚写进去的
        # 那份字节清掉——留着的话，每同步一次就多一份没人引用的副本
        await _swept(deps.store, key)
        return False
    document_service.queue_ingest(
        session,
        deps.stream,
        deps.group,
        document_service.document_out(await _reloaded(session, document_id)),
    )
    return True


async def _reloaded(
    session: AsyncSession, document_id: uuid.UUID
) -> crud.document.KnowledgeDocument:
    row = await crud.document.get_document(session, document_id)
    # pragma 理由：刚 flush 进去的行，取不到即数据库出了别的问题
    if row is None:  # pragma: no cover
        raise RuntimeError("文档刚登记就取不到了")
    return row


async def _swept(store: ObjectStore, key: str) -> None:
    try:
        await store.delete(key)
    except ObjectStoreError as error:
        _logger.warning(
            "sync_orphan_left",
            "重复条目的字节没清掉，留了一份没人引用的副本",
            key=key,
            error=error,
        )


def sync_out(made: SyncOutcome) -> SyncOut:
    """一次同步的结果摊成出参。

    Args: made。
    """
    return SyncOut(
        registered=made.registered,
        skipped=made.skipped,
        has_more=made.has_more,
    )


async def sync_source(
    session: AsyncSession, deps: SyncDeps, source_id: uuid.UUID
) -> SyncOutcome:
    """把一路来源里的新条目摄进来，回这一次登记了几条。

    Args: session, deps, source_id。
    """
    source = await crud.source.get_source(session, source_id)
    if source is None:
        raise SourceNotFound("这一路来源不存在")
    picked = source_for(source.kind, deps.sources)
    cursor = source.sync_cursor
    registered = 0
    skipped = 0
    pages = 0
    while pages < deps.max_pages:
        pages += 1
        page = await picked.discover(dict(source.config_json), cursor)
        for item in page.items:
            if await _registered(session, deps, source, item):
                registered += 1
            else:
                skipped += 1
        cursor = page.cursor
        if cursor is None:
            break
    await crud.source.mark_synced(session, source_id, cursor, utcnow())
    return SyncOutcome(
        registered=registered, skipped=skipped, has_more=cursor is not None
    )
