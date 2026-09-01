"""文档的读写编排：签直传凭证、登记、列、删、重新解析。

⚠ 直传那两步刻意分开（签凭证 / 登记）。签凭证那一步**不落行**：没传成的
文档不会在库里留下半条记录，界面上也就不会出现一份永远停在 pending 的鬼影。

⚠ 登记之后才投队列，且**必须在事务提交之后**投：提交前投出去的话，worker
可能先于提交读到——那时文档行还不存在，它只能当成「文档已删」丢掉，
而原件其实好好的。
"""

import hashlib
import uuid
from collections.abc import Sequence

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.errors import (
    DocumentNotFound,
    DuplicateDocument,
    SourceNotFound,
    UnsupportedRawItem,
)
from knowledge_server.apps.knowledge.models import KnowledgeDocument
from knowledge_server.apps.knowledge.schemas import (
    DocumentOut,
    RegisterDocumentIn,
    UploadTicketIn,
    UploadTicketOut,
)
from knowledge_server.apps.knowledge.services import ingest_queue
from knowledge_server.apps.knowledge.services.parsing import (
    accepted_suffixes,
)
from knowledge_server.apps.knowledge.services.sources import (
    UPLOAD_KIND,
    document_key,
    staging_key,
    suffix_of,
)
from knowledge_server.settings import MAX_RAW_BYTES
from lib.db import after_commit
from lib.objectstore import (
    ObjectStore,
    ObjectStoreError,
    PresignedPost,
    UploadLimits,
)
from lib.stream import StreamGroup, StreamLike
from lib.utils.ids import uuid7
from lib.web import Page, PageParams

# 直传凭证的存活时长。⚠ 短一点：这张表单能往我们的桶里写字节，签出去之后
# 谁拿到都能用
UPLOAD_TTL_S = 15 * 60
# 允许的最小字节数。⚠ 不是 0：一份 0 字节的文件传得上去、解出来是空的、
# 状态却是 ready，而那与「这份文档里确实没这句话」长得一模一样
MIN_UPLOAD_BYTES = 1


def document_out(row: KnowledgeDocument) -> DocumentOut:
    """一行文档摊成出参。

    Args: row。
    """
    return DocumentOut(
        id=row.id,
        base_id=row.base_id,
        source_id=row.source_id,
        title=row.title,
        media_type=row.media_type,
        byte_size=row.byte_size,
        status=row.status,
        failure_reason=row.failure_reason,
        chunk_count=row.chunk_count,
        created_at=row.created_at,
        ready_at=row.ready_at,
    )


def document_page(
    rows: Sequence[KnowledgeDocument], params: PageParams, total: int
) -> Page[DocumentOut]:
    """一页文档摊成分页出参。

    Args: rows, params, total。
    """
    return Page[DocumentOut](
        items=[document_out(one) for one in rows],
        page=params.page,
        size=params.size,
        total=total,
    )


def _checked_suffix(filename: str) -> str:
    """取一个这套部署认得的后缀；认不出就当场拒。

    ⚠ 在**签凭证那一步**就拒，不等到摄取时：让用户传完 200 MB 再告诉他
    「不收这种格式」是两次浪费，而第二次那句错还夹在异步管线里。

    Args: filename。
    """
    suffix = suffix_of(filename)
    if suffix not in accepted_suffixes():
        raise UnsupportedRawItem(
            f"认不出 {filename} 是什么格式。这套部署收："
            f"{'、'.join(accepted_suffixes())}"
        )
    return suffix


async def presign_upload(
    store: ObjectStore, base_id: uuid.UUID, body: UploadTicketIn
) -> UploadTicketOut:
    """铸一个文档 id 并签一张直传表单。**不落行**。

    ⚠ id 在这一步就铸好并编进对象键：登记那一步只认这个键，客户端没法把字节
    传到一个 id 下、再拿另一个 id 来登记。

    Args: store, base_id, body。
    """
    suffix = _checked_suffix(body.filename)
    if body.size_bytes > MAX_RAW_BYTES:
        raise UnsupportedRawItem(
            f"这份文件 {body.size_bytes} 字节，超过上限 {MAX_RAW_BYTES}"
        )
    document_id = uuid7()
    key = staging_key(base_id, document_id, suffix)
    ticket = await _presign(store, key, body)
    return UploadTicketOut(
        document_id=document_id,
        url=ticket.url,
        fields=ticket.fields,
        object_key=ticket.key,
        expires_seconds=ticket.expires_seconds,
    )


async def _presign(
    store: ObjectStore, key: str, body: UploadTicketIn
) -> PresignedPost:
    try:
        return await store.presign_post(
            key,
            content_type=body.content_type or "application/octet-stream",
            limits=UploadLimits(
                min_bytes=MIN_UPLOAD_BYTES, max_bytes=MAX_RAW_BYTES
            ),
            ttl_s=UPLOAD_TTL_S,
        )
    except ObjectStoreError as error:
        raise ObjectStoreError("对象存储暂时不可用") from error


async def _hash_and_move(
    store: ObjectStore, staging: str, final: str
) -> tuple[str, int]:
    """把暂存的字节读一遍算哈希，再挪到正式键。

    ⚠ 哈希在**服务端**算，不信客户端报的：客户端报什么我们就存什么的话，
    去重就成了一句空话——两份不同内容报同一个哈希，第二份会被当成重复丢掉。

    ⚠ 挪完删暂存件。删失败只留下一份没人引用的字节，不影响正确性，
    所以不因此让整次登记失败。

    Args: store, staging, final。
    """
    content = await store.get_bytes(staging)
    digest = hashlib.sha256(content).hexdigest()
    await store.copy(staging, final)
    await store.delete(staging)
    return (digest, len(content))


async def register_upload(
    session: AsyncSession,
    store: ObjectStore,
    base_id: uuid.UUID,
    body: RegisterDocumentIn,
) -> DocumentOut:
    """确认直传完成：算哈希、挪进正式键、落一行文档。

    ⚠ 这一步**不投队列**：投递要等事务提交之后。调用方拿到出参之后调
    `queue_ingest`。

    Args: session, store, base_id, body。
    """
    source = await crud.source.find_source_by_kind(
        session, base_id, UPLOAD_KIND
    )
    if source is None:
        raise SourceNotFound("这个库没有上传通道")
    suffix = _checked_suffix(body.filename)
    staging = staging_key(base_id, body.document_id, suffix)
    final = document_key(base_id, body.document_id, suffix)
    digest, size = await _hash_and_move(store, staging, final)
    try:
        await crud.document.insert_document(
            session,
            crud.document.DocumentWrite(
                document_id=body.document_id,
                base_id=base_id,
                source_id=source.id,
                external_ref=final,
                title=body.filename,
                media_type="",
                object_key=final,
                byte_size=size,
                content_hash=digest,
            ),
        )
    except IntegrityError as error:
        # ⚠ 翻成一句人话再抛。不翻的话冒上去的是一条 500，而那句里写着
        # 「duplicate key value violates unique constraint」——用户看不懂，
        # 而它其实是一件完全正常的事：这份内容已经在库里了
        raise DuplicateDocument("这份内容已经在这个库里了") from error
    row = await crud.document.get_document(session, body.document_id)
    # pragma 理由：刚 flush 进去的行，取不到即数据库出了别的问题
    if row is None:  # pragma: no cover
        raise DocumentNotFound("文档刚登记就取不到了")
    return document_out(row)


def queue_ingest(
    session: AsyncSession,
    stream: StreamLike,
    group: StreamGroup,
    document: DocumentOut,
) -> None:
    """事务提交之后把摄取任务投进队列。

    ⚠ 挂在 after-commit 钩子上而不是当场投：当场投的话，worker 可能先于提交
    读到，那时文档行还不存在。

    ⚠ `stream` 与 `group` 分成两个形参而不是打成一包：打包那一版把
    `StreamGroup` 当成了包本身，于是 `target.stream` 取到的是**流的名字**
    （一个字符串）而不是客户端——而它只在投递时炸，被那条「投递失败不回滚」
    的兜底吞成一行日志。真库用例才逮到。

    Args: session, stream, group, document。
    """

    async def dispatch() -> None:
        await ingest_queue.dispatch_ingest(
            stream,
            group,
            ingest_queue.new_message(document.id, document.base_id),
        )

    after_commit(session, dispatch)


async def read_document(
    session: AsyncSession, document_id: uuid.UUID
) -> KnowledgeDocument:
    """取一份文档；没有就抛。

    Args: session, document_id。
    """
    row = await crud.document.get_document(session, document_id)
    if row is None:
        raise DocumentNotFound("文档不存在")
    return row


async def requeue_document(
    session: AsyncSession,
    stream: StreamLike,
    group: StreamGroup,
    document_id: uuid.UUID,
) -> DocumentOut:
    """把一份文档退回待处理并重新排队。

    ⚠ 这是这条链路上**唯一**的重试入口，而且它由人按（runtime-resilience §4：
    一条链路只有一层负责重试）。一份解不动的文档自动重试一万次也解不动，
    只会把 worker 占满。

    Args: session, stream, group, document_id。
    """
    row = await read_document(session, document_id)
    await crud.document.mark_status(session, row.id, "pending")
    made = document_out(row)
    queue_ingest(session, stream, group, made)
    return made


async def drop_document(
    session: AsyncSession, store: ObjectStore, document_id: uuid.UUID
) -> None:
    """删一份文档：先删行，提交之后再清对象。

    ⚠ 顺序不能反。先清对象再删行的话，删行失败会留下一行指着不存在的原件，
    而它看起来是一份正常文档，重新解析时才炸。

    ⚠ 清对象挂在提交之后：事务里禁做外部 IO。清失败只留下一份没人引用的
    字节，不影响正确性。

    Args: session, store, document_id。
    """
    row = await read_document(session, document_id)
    key = row.object_key
    await crud.document.delete_document(session, document_id)
    if not key:
        return

    async def sweep() -> None:
        await store.delete(key)

    after_commit(session, sweep)
