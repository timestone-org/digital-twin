"""摄取管线：一份文档从 pending 走到 ready 的那几段。

```
pending → parsing → chunking → embedding → indexing → ready
   └──────────┴──────────┴──────────┴──────────┴────────→ failed
```

⚠ 状态**落在文档行上**，不留内存：worker 是多副本、可重启的；留内存的话一次
重启就把「它卡在哪一步」全丢了，而界面上表现为「一直在处理中」。

⚠ **每一段自己一个事务**（与模型压缩那条链同源）。整条管线一个事务的话，
中间那几次 `mark_status` 在提交之前谁都看不见——于是「界面上看得见它停在哪」
这句话是假的：外面只看得到 pending 与终态两种。

⚠ 队列是 at-least-once，所以判幂等看的是**那一行的状态**——已经 `ready` 的
直接跳过。「先查再插」不是幂等（两次并发会双双查空、双双插入）。

⚠ 解析有两条口径，分成两支而不是一个函数（ADR-0043）：本地库解那一路是纯
CPU 且阻塞的，扔进**进程池**——放进事件循环会把整条消费循环连同健康探针一起
冻住，而现象是「服务好好的，队列不动了」；外部解析服务那一路是**网络 IO**，
必须带自己的超时，且**不自动重试**（重试只由人按「重新解析」那一层负责）。

⚠ **嵌入是这条链路的必经段**，没接就判 failed 并说清楚缺什么（ADR-0045）：
检索只有向量与关键词两路，而其中一路缺席的库在界面上与「建好了」长得一模一样，
只是永远召不回意思相近的那几段。

⚠ 判「接没接」之前先刷一次模型目录：worker 进程里没有别的地方刷它，而
`can_embed` 问的是手上那份快照——不刷的话它恒假，于是每一份文档都跳过嵌入
走到 ready，而界面上的能力面（api 进程刷过）说的是「已接」。
"""

import asyncio
import uuid
from collections.abc import Awaitable, Callable, Sequence
from concurrent.futures import Executor
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.services.chunking import (
    Chunk,
    chunker_for,
)
from knowledge_server.apps.knowledge.services.embedding import Embedder
from knowledge_server.apps.knowledge.services.indexing import (
    IndexPair,
    VectorRows,
)
from knowledge_server.apps.knowledge.services.parsing import (
    ExternalParseFailed,
    ExternalParserBackend,
    ParsedDocument,
    RawItem,
    UnsupportedRawItem,
    external_for,
    parse_local,
)
from knowledge_server.apps.knowledge.services.sources import (
    KnowledgeSource,
    UnknownSource,
    source_for,
)
from lib.logging import get_logger

_logger = get_logger("knowledge.ingest")

READY = "ready"
FAILED = "failed"

# 开一个新事务的口子。⚠ 收工厂而不是收一个会话：每一段要自己一个事务，
# 而一个会话给不出那件事
Sessions = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# 让模型目录刷新一次的口子。⚠ 收成一个口子而不是直接认 `CatalogCache`：
# 管线在 apps 层，认了它就把领域逻辑钉死在某一路目录实现上
Refresh = Callable[[], Awaitable[object]]


async def _no_refresh() -> None:
    """不刷目录。用例里那些自己塞了假嵌入档的用不着它。"""


class IngestFailed(RuntimeError):
    """这一份文档摄不进来，而且重试没有意义。

    ⚠ 与「此刻拿不到」（`SourceUnavailable`）分开：后者重试有意义（对方抖了
    一下），前者一万次也一样（格式不认、原件没了）。混成一档的话，一份解不动
    的文档会被无限认领重投。
    """


@dataclass(frozen=True)
class IngestDeps:
    """跑一次摄取要的那几样。

    ⚠ 打成一包而不是逐个形参：调用面的形参上限是 5，而这里天然要五样以上。
    """

    sources: tuple[KnowledgeSource, ...]
    embedder: Embedder
    indexes: IndexPair
    pool: Executor
    parse_timeout_s: float
    batch_size: int = 16
    # 判「接没接嵌入档」之前先让目录刷新一次。⚠ 缺省不刷是给用例用的：
    # 生产的 worker 必须把它接上，理由见模块头
    refresh: Refresh = _no_refresh
    # 接了哪几路外部解析后端。⚠ 一期恒空——没接就是诚实缺席（ADR-0043）
    external_parsers: tuple[ExternalParserBackend, ...] = ()
    # 外部那一路一次调用最多等多久
    external_parse_timeout_s: float = 180.0


@dataclass(frozen=True)
class _Pending:
    """一份待摄取文档里，管线真正要用的那几格。

    ⚠ 只带走这几格而不是整个 ORM 行：行绑在某一个会话上，而管线跨好几个事务——
    出了那个会话再读它的属性会触发一次惰性加载，在 asyncio 会话里那是
    `MissingGreenlet`，且只在「刚好没预加载」的路径上才炸。
    """

    document_id: uuid.UUID
    base_id: uuid.UUID
    source_id: uuid.UUID
    external_ref: str


async def _raw_of(
    sessions: Sessions, deps: IngestDeps, document: _Pending
) -> RawItem:
    """按这份文档所属的那一路来源，把原件取回来。

    ⚠ 取原件是一次**外部 IO**，所以先把来源配置读出来、关掉事务，再去取：
    事务里做外部 IO 会让一次上游超时把连接占住几十秒（database-standard）。

    Args: sessions, deps, document。
    """
    async with sessions() as session:
        source = await crud.source.get_source(session, document.source_id)
        if source is None:
            raise IngestFailed("这份文档所属的来源已经不在了")
        kind = source.kind
        config = dict(source.config_json)
    try:
        return await source_for(kind, deps.sources).fetch(
            config, document.external_ref
        )
    except UnknownSource as error:
        raise IngestFailed(str(error)) from error
    except FileNotFoundError as error:
        raise IngestFailed("原件已经不在对象存储里了") from error


async def _parsed_locally(deps: IngestDeps, raw: RawItem) -> ParsedDocument:
    """在进程池里解析，超时就当这一份解不动。

    ⚠ 超时必须有：没有超时的解析会把这条消费循环永久占住，而现象是
    「队列不动了」，看不出是哪一份文档导致的。

    Args: deps, raw。
    """
    loop = asyncio.get_running_loop()
    try:
        async with asyncio.timeout(deps.parse_timeout_s):
            return await loop.run_in_executor(deps.pool, parse_local, raw)
    except TimeoutError as error:
        raise IngestFailed("解析超时，这份文档可能过大") from error
    except UnsupportedRawItem as error:
        raise IngestFailed(str(error)) from error


async def _parsed_remotely(
    backend: ExternalParserBackend, deps: IngestDeps, raw: RawItem
) -> ParsedDocument:
    """交给外部解析服务，超时或它报错都当这一份解不动。

    ⚠ 外面这一层 `timeout` 是兜底：端口要求实现自己守住 `timeout_s`，而一个
    不守约的实现会把整条消费循环占死——现象仍是「队列不动了」。

    ⚠ **不重试**：失败即写 `failed`，由人在界面上按「重新解析」。
    runtime-resilience §4——一条链路只有一层负责重试，而那一层是人按的那一下。

    Args: backend, deps, raw。
    """
    try:
        async with asyncio.timeout(deps.external_parse_timeout_s):
            return await backend.parse_remote(
                raw, deps.external_parse_timeout_s
            )
    except TimeoutError as error:
        raise IngestFailed(
            f"外部解析服务 {backend.name} 没在限时内给出结果"
        ) from error
    except ExternalParseFailed as error:
        raise IngestFailed(str(error)) from error


async def _parsed(deps: IngestDeps, raw: RawItem) -> ParsedDocument:
    """挑一路后端把这份原件解开。

    ⚠ 两支不合成一个函数：本地那一路阻塞且吃 CPU，必须进进程池；外部那一路是
    网络 IO，要带自己的超时。合成一个的话，那两条口径就只剩注释在维持了。

    Args: deps, raw。
    """
    backend = external_for(raw, deps.external_parsers)
    if backend is None:
        return await _parsed_locally(deps, raw)
    return await _parsed_remotely(backend, deps, raw)


def _batched(
    rows: Sequence[tuple[uuid.UUID, str]], size: int
) -> list[Sequence[tuple[uuid.UUID, str]]]:
    """按批切。

    ⚠ 有上限：嵌入端点对单次请求的总 token 有限，超了**整批**失败——
    而失败的是「这一次摄取」不是「这一段」。

    Args: rows, size。
    """
    step = max(1, size)
    return [rows[at : at + step] for at in range(0, len(rows), step)]


async def _indexed(
    sessions: Sessions,
    deps: IngestDeps,
    base_id: uuid.UUID,
    rows: Sequence[tuple[uuid.UUID, str]],
) -> None:
    """把块文本嵌成向量并写进索引。

    ⚠ 一批一批来，而且**每批一个事务**：一整份大文档攒到最后一起写的话，
    中途失败就等于白算——而算过的那几批是花过钱的。

    ⚠ 嵌入调用在事务**之外**：它是一次跨网络的外部 IO，包在事务里会让一次
    端点超时把数据库连接占住几十秒。

    Args: sessions, deps, base_id, rows。
    """
    for batch in _batched(rows, deps.batch_size):
        made = await deps.embedder.embed([text for _one, text in batch])
        async with sessions() as session:
            await deps.indexes.vector.upsert(
                session,
                VectorRows(
                    base_id=base_id,
                    model=deps.embedder.id,
                    dimensions=deps.embedder.dimensions,
                    rows=tuple(
                        (chunk_id, vector)
                        for (chunk_id, _text), vector in zip(
                            batch, made, strict=True
                        )
                    ),
                ),
            )


def _chunked(document: ParsedDocument, chunker: str) -> tuple[Chunk, ...]:
    """按库上配的切法切块。

    Args: document, chunker。
    """
    return chunker_for(chunker).split(document)


async def _claimed(
    sessions: Sessions, document_id: uuid.UUID
) -> _Pending | None:
    """把这份文档推进 parsing 并带走要用的那几格；不该跑就给 `None`。

    ⚠ 判幂等看的是**那一行的状态**：已经 ready 的直接跳过。「先查再插」不是
    幂等，而队列是 at-least-once，重复投递是常态。

    Args: sessions, document_id。
    """
    async with sessions() as session:
        row = await crud.document.get_document(session, document_id)
        if row is None or row.status == READY:
            return None
        await crud.document.mark_status(session, row.id, "parsing")
        return _Pending(
            document_id=row.id,
            base_id=row.base_id,
            source_id=row.source_id,
            external_ref=row.external_ref,
        )


async def _embeddable(deps: IngestDeps) -> None:
    """先刷一次目录，再确认这套部署此刻算得出向量；算不出就别往下走。

    ⚠ 排在取原件之前：一份 200 MB 的文档解完再说「这套部署没配嵌入模型」，
    是把一次必然的失败拖到最贵的那一步之后。

    Args: deps。
    """
    await deps.refresh()
    if deps.embedder.can_embed:
        return
    raise IngestFailed(
        "这套部署此刻算不出向量：模型目录里没有给「知识库嵌入」这个用途"
        "分配可用的模型。配好之后按「重新解析」"
    )


async def _staged(
    sessions: Sessions, document_id: uuid.UUID, status: str
) -> None:
    """把状态推到下一段，自己一个事务。

    Args: sessions, document_id, status。
    """
    async with sessions() as session:
        await crud.document.mark_status(session, document_id, status)


async def ingest(
    sessions: Sessions, deps: IngestDeps, document_id: uuid.UUID
) -> str:
    """把一份文档从 pending 走到 ready，回它的终态。

    ⚠ 每一段自己一个事务：整条一个事务的话，中间那几次状态在提交之前谁都
    看不见——而「界面上看得见它停在哪」这句话就是假的。

    Args: sessions, deps, document_id。
    """
    document = await _claimed(sessions, document_id)
    if document is None:
        _logger.info(
            "ingest_skipped",
            "文档已被删或已就绪，跳过",
            document_id=str(document_id),
        )
        return "skipped"
    await _embeddable(deps)
    raw = await _raw_of(sessions, deps, document)
    parsed = await _parsed(deps, raw)
    await _staged(sessions, document.document_id, "chunking")
    chunks = _chunked(parsed, "")
    async with sessions() as session:
        chunk_ids = await crud.chunk.replace_chunks(
            session, document.base_id, document.document_id, chunks
        )
    if chunks:
        await _staged(sessions, document.document_id, "embedding")
        await _indexed(
            sessions,
            deps,
            document.base_id,
            list(zip(chunk_ids, [one.text for one in chunks], strict=True)),
        )
    async with sessions() as session:
        await crud.document.mark_ready(
            session, document.document_id, len(chunks), datetime.now(UTC)
        )
    return READY


async def mark_failed(
    sessions: Sessions, document_id: uuid.UUID, reason: str
) -> None:
    """把一份文档记成失败，原因写成一句人话。

    ⚠ 原因**会原样上界面**：不许带表名、SQL 与内网地址。

    ⚠ 自己一个事务：调用它的时候管线那几个事务早已各自了结，而失败这件事
    必须落下去——挂在别人的事务上，一次回滚就把它一起抹了。

    Args: sessions, document_id, reason。
    """
    async with sessions() as session:
        await crud.document.mark_status(session, document_id, FAILED, reason)
