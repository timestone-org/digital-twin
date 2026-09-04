"""文档的读写面：签直传凭证、登记、列、删、重新解析。

⚠ 文档挂在**顶层**而不是 `/knowledge-bases/{id}/documents/{id}`：嵌套超过两层
之后，「按状态筛所有库的文档」这类查询就没地方放了（api-contract §1）。
库的归属走 `base_id` 过滤。
"""

import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.schemas import (
    DocumentOut,
    RegisterDocumentIn,
    UploadTicketIn,
    UploadTicketOut,
    checked_status,
)
from knowledge_server.apps.knowledge.services import (
    document_service,
    library_service,
)
from knowledge_server.catalog import (
    KNOWLEDGE_USE,
    KNOWLEDGE_WRITE,
)
from knowledge_server.container import Container
from knowledge_server.deps import get_container, get_session, require
from knowledge_server.settings import API_PREFIX
from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params

router = APIRouter(prefix=f"{API_PREFIX}/documents", tags=["document"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ContainerDep = Annotated[Container, Depends(get_container)]
UseDep = Annotated[CallerContext, Depends(require(KNOWLEDGE_USE))]
WriteDep = Annotated[CallerContext, Depends(require(KNOWLEDGE_WRITE))]

# 图的缓存时长。⚠ 只能是 `private`：这张图是某个库里的内容，不许被共享缓存
# 留下来。ETag 用内容哈希，所以时长长一点也不会拿到旧图
FIGURE_CACHE_S = 3600
# 原件的缓存时长。同上只能是 `private`，ETag 同样是内容哈希——重新解析不改
# 字节，那份缓存因此仍然有效
RAW_CACHE_S = 3600
# 用户传上来的字节在浏览器里的安全护栏，两条都不能省：
# `nosniff` 挡住「声明成 text/plain、浏览器嗅成 HTML 去执行」那一路；
# `sandbox` 让万一真被当成文档渲染的那一份跑在不透明源上、脚本不执行。
# ⚠ `default-src 'none'` 一并把它往外发信标的路也断了
RAW_GUARD_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
}
PageDep = Annotated[PageParams, Depends(page_params)]


@router.post(
    ":upload-ticket",
    response_model=ApiResponse[UploadTicketOut],
    status_code=status.HTTP_201_CREATED,
    summary="申请直传凭证",
)
async def upload_ticket(
    session: SessionDep,
    container: ContainerDep,
    _actor: WriteDep,
    base_id: Annotated[uuid.UUID, Query()],
    body: UploadTicketIn,
) -> ApiResponse[UploadTicketOut]:
    """铸一个文档 id 并签一张把键、类型与大小都钉死的直传表单。

    Args: session, container, _actor, base_id, body。
    """
    await library_service.read_base(session, base_id)
    return ok(
        await document_service.presign_upload(
            container.objectstore, base_id, body, container.external_parsers
        )
    )


@router.post(
    "",
    response_model=ApiResponse[DocumentOut],
    status_code=status.HTTP_201_CREATED,
    summary="确认直传完成",
)
async def register(
    session: SessionDep,
    container: ContainerDep,
    _actor: WriteDep,
    base_id: Annotated[uuid.UUID, Query()],
    body: RegisterDocumentIn,
) -> ApiResponse[DocumentOut]:
    """算哈希、挪进正式键、落一行文档，提交之后投摄取任务。

    Args: session, container, _actor, base_id, body。
    """
    await library_service.read_base(session, base_id)
    parsers = container.external_parsers
    made = await document_service.register_upload(
        session, container.objectstore, base_id, body, parsers
    )
    document_service.queue_ingest(
        session, container.stream, container.ingest_group(), made
    )
    return ok(made)


@router.get("", response_model=ApiResponse[Page[DocumentOut]])
async def list_all(
    session: SessionDep,
    _viewer: UseDep,
    params: PageDep,
    base_id: Annotated[uuid.UUID, Query()],
    status_filter: Annotated[str, Query(alias="status")] = "",
) -> ApiResponse[Page[DocumentOut]]:
    """列一个库下的文档，可按摄取状态筛。

    Args: session, _viewer, params, base_id, status_filter。
    """
    rows, total = await crud.document.list_documents(
        session,
        base_id,
        checked_status(status_filter),
        (params.offset, params.size),
    )
    return ok(document_service.document_page(rows, params, total))


@router.get("/{document_id}", response_model=ApiResponse[DocumentOut])
async def get_one(
    session: SessionDep, _viewer: UseDep, document_id: uuid.UUID
) -> ApiResponse[DocumentOut]:
    """取一份文档。

    Args: session, _viewer, document_id。
    """
    row = await document_service.read_document(session, document_id)
    return ok(document_service.document_out(row))


@router.post(
    "/{document_id}:reparse",
    response_model=ApiResponse[DocumentOut],
    summary="重新解析",
)
async def reparse(
    session: SessionDep,
    container: ContainerDep,
    _actor: WriteDep,
    document_id: uuid.UUID,
) -> ApiResponse[DocumentOut]:
    """把一份文档退回待处理并重新排队。

    ⚠ 这是这条链路上**唯一**的重试入口，而且它由人按：一份解不动的文档
    自动重试一万次也解不动，只会把 worker 占满。

    Args: session, container, _actor, document_id。
    """
    return ok(
        await document_service.requeue_document(
            session, container.stream, container.ingest_group(), document_id
        )
    )


@router.get(
    "/{document_id}/figures/{figure_id}",
    summary="取一张解析出来的图",
    response_class=Response,
)
async def read_figure(
    session: SessionDep,
    container: ContainerDep,
    _viewer: UseDep,
    document_id: uuid.UUID,
    figure_id: uuid.UUID,
) -> Response:
    """把一张图的字节吐出去。⚠ 回的是字节不是信封（api-contract 的显式豁免）。

    Args: session, container, _viewer, document_id, figure_id。
    """
    made = await document_service.read_figure(
        session, container.objectstore, document_id, figure_id
    )
    return _figure_response(made)


def _figure_response(made: document_service.FigureBytes) -> Response:
    """一张图连缓存头。

    ⚠ 缓存只能是 `private`：这张图是某个库里的内容，不许被共享缓存留下来。
    ⚠ `ETag` 用内容哈希而不是时间戳：重新解析之后哈希不变，浏览器那份缓存
    因此仍然有效——而按时间戳的话每次重新解析都要重下一遍全部图。

    Args: made。
    """
    return Response(
        content=made.content,
        media_type=made.media_type,
        headers={
            "ETag": f'"{made.etag}"',
            "Cache-Control": f"private, max-age={FIGURE_CACHE_S}",
        },
    )


@router.get(
    "/{document_id}/raw",
    summary="取原件的字节",
    response_class=Response,
)
async def read_raw(
    session: SessionDep,
    container: ContainerDep,
    _viewer: UseDep,
    document_id: uuid.UUID,
) -> Response:
    """把一份文档的原件吐出去，供页面里预览与下载。

    ⚠ 回的是字节不是信封（与图那条同一份 api-contract 显式豁免）。

    Args: session, container, _viewer, document_id。
    """
    made = await document_service.read_raw(
        session, container.objectstore, document_id
    )
    return _raw_response(made)


def _raw_response(made: document_service.RawBytes) -> Response:
    """一份原件连缓存头、护栏头与文件名。

    ⚠ `Content-Disposition` 的取值由**类型白名单**定，不由调用方定：把用户传上
    来的 HTML 以 `inline` 摊在本站域名下，那份 HTML 里的脚本就跑在本站源上，
    能读这个源的存储、能替用户调接口——一次上传就是一次存储型 XSS。
    页面里的预览另有安全的画法（沙箱 iframe），不靠这条端点摊开。

    Args: made。
    """
    return Response(
        content=made.content,
        media_type=made.media_type,
        headers={
            "ETag": f'"{made.etag}"',
            "Cache-Control": f"private, max-age={RAW_CACHE_S}",
            "Content-Disposition": _disposition(made),
            **RAW_GUARD_HEADERS,
        },
    )


def _disposition(made: document_service.RawBytes) -> str:
    """摆出去还是存下来，以及存成什么名字。

    ⚠ 文件名走 RFC 5987 的 `filename*`，**且不再给 ASCII 那一份**：响应头按
    latin-1 编码，一个中文名直接让整条响应在编码那一步炸掉，而炸的地方离
    「文件名」三个字很远。百分号编码之后它只剩 ASCII。

    Args: made。
    """
    how = "inline" if made.is_inline else "attachment"
    return f"{how}; filename*=UTF-8''{quote(made.filename, safe='')}"


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def drop(
    session: SessionDep,
    container: ContainerDep,
    _actor: WriteDep,
    document_id: uuid.UUID,
) -> None:
    """删一份文档：先删行，提交之后再清原件。

    Args: session, container, _actor, document_id。
    """
    await document_service.drop_document(
        session, container.objectstore, document_id
    )
