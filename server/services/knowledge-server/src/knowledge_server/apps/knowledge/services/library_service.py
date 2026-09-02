"""知识库与来源的读写编排。事务边界在这一层持有。

⚠ 建库时**同时建出上传那一路来源**：不建的话，第一次上传要先让用户去
「加一路来源」，而那一步对上传来说毫无意义。上传是每个库的默认能力。
"""

import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.errors import (
    KnowledgeBaseNotFound,
    SourceNotFound,
)
from knowledge_server.apps.knowledge.models import (
    KnowledgeBase,
    KnowledgeSource,
)
from knowledge_server.apps.knowledge.schemas import (
    KnowledgeBaseIn,
    KnowledgeBaseOut,
    SourceIn,
    SourceOut,
)
from knowledge_server.apps.knowledge.services.sources import (
    UPLOAD_KIND,
    base_prefix,
)
from lib.db import after_commit
from lib.objectstore import ObjectStore

# 建库时自动建出来的那一路来源叫什么
UPLOAD_SOURCE_NAME = "文件上传"


@dataclass(frozen=True)
class EmbeddingChoice:
    """建库那一刻此刻接得上的嵌入档。

    ⚠ 由服务端填、不由调用方指定：写错维数的话，整库的向量从第一条起就算不出
    有意义的余弦，而没有任何一处会报错。
    """

    model: str | None
    dimensions: int | None

    @classmethod
    def of(cls, given: tuple[str | None, int | None]) -> "EmbeddingChoice":
        """从容器报的那两格造一个。

        Args: given。
        """
        return cls(model=given[0], dimensions=given[1])


@dataclass(frozen=True)
class BaseBrief:
    """一个库给模型看的简报：只有挑库要用的那几格。"""

    id: uuid.UUID
    name: str
    description: str
    strategy: str
    is_indexed: bool


async def brief_bases(
    session: AsyncSession, *, limit: int
) -> tuple[list[BaseBrief], int]:
    """列一页库的简报与总数。给对话面的 `kb.list_bases` 用。

    Args: session, limit。
    """
    rows, total = await crud.knowledge_base.list_bases(
        session, offset=0, limit=limit
    )
    return (
        [
            BaseBrief(
                id=one.id,
                name=one.name,
                description=one.description,
                strategy=one.retrieval_strategy,
                is_indexed=one.embedding_model is not None,
            )
            for one in rows
        ],
        total,
    )


def base_out(row: KnowledgeBase, document_count: int) -> KnowledgeBaseOut:
    """一行库摊成出参。

    Args: row, document_count。
    """
    return KnowledgeBaseOut(
        id=row.id,
        name=row.name,
        description=row.description,
        retrieval_strategy=row.retrieval_strategy,
        embedding_model=row.embedding_model,
        dimensions=row.dimensions,
        owner_id=row.owner_id,
        document_count=document_count,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def source_out(row: KnowledgeSource) -> SourceOut:
    """一行来源摊成出参。

    Args: row。
    """
    return SourceOut(
        id=row.id,
        base_id=row.base_id,
        kind=row.kind,
        name=row.name,
        config=dict(row.config_json),
        last_synced_at=row.last_synced_at,
        last_error=row.last_error,
        created_at=row.created_at,
    )


async def create_base(
    session: AsyncSession,
    body: KnowledgeBaseIn,
    owner_id: str,
    embedding: EmbeddingChoice,
) -> KnowledgeBaseOut:
    """建一个库，并顺手建出上传那一路来源。

    Args: session, body, owner_id, embedding。
    """
    row = await crud.knowledge_base.insert_base(
        session,
        crud.knowledge_base.BaseWrite(
            name=body.name,
            description=body.description,
            owner_id=owner_id,
            embedding_model=embedding.model,
            dimensions=embedding.dimensions,
            retrieval_strategy=body.retrieval_strategy,
        ),
    )
    await crud.source.insert_source(
        session, row.id, UPLOAD_KIND, UPLOAD_SOURCE_NAME, {}
    )
    return base_out(row, 0)


async def read_base(session: AsyncSession, base_id: uuid.UUID) -> KnowledgeBase:
    """取一个库；没有就抛。

    ⚠ 404 同时覆盖「不存在」与「无权看见」：id 是可枚举的，用 403 区分这两件
    事等于逐个 id 回答「这一条确实存在」。

    Args: session, base_id。
    """
    row = await crud.knowledge_base.get_base(session, base_id)
    if row is None:
        raise KnowledgeBaseNotFound("知识库不存在")
    return row


async def add_source(
    session: AsyncSession, base_id: uuid.UUID, body: SourceIn
) -> SourceOut:
    """给一个库加一路来源。

    Args: session, base_id, body。
    """
    await read_base(session, base_id)
    row = await crud.source.insert_source(
        session, base_id, body.kind, body.name, body.config
    )
    return source_out(row)


async def read_source(
    session: AsyncSession, source_id: uuid.UUID
) -> KnowledgeSource:
    """取一路来源；没有就抛。

    Args: session, source_id。
    """
    row = await crud.source.get_source(session, source_id)
    if row is None:
        raise SourceNotFound("这一路来源不存在")
    return row


async def drop_base(
    session: AsyncSession, store: ObjectStore, base_id: uuid.UUID
) -> None:
    """删一个库：先删行，提交之后再清这个库名下的全部原件。

    ⚠ 顺序不能反，理由与删文档同源：先清对象再删行的话，删行失败会留下一整个
    库指着一堆不存在的原件，而它看起来是个正常的库。

    ⚠ 清对象挂在提交之后：事务里禁做外部 IO。清失败只留下一堆没人引用的字节，
    不影响正确性。

    Args: session, store, base_id。
    """
    await read_base(session, base_id)
    await crud.knowledge_base.delete_base(session, base_id)
    prefix = base_prefix(base_id)

    async def sweep() -> None:
        await store.delete_prefix(prefix)

    after_commit(session, sweep)
