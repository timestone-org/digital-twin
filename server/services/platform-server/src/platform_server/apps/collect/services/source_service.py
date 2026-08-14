"""数据源管理面。事务边界在这一层：crud 不提交，api 不写业务。"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.web import Page, PageParams
from platform_server.apps.collect.crud import (
    point_crud,
    source_crud,
)
from platform_server.apps.collect.crud.source import DEFAULT_ORDER, SORTABLE
from platform_server.apps.collect.errors import (
    SourceCodeTaken,
    SourceNotEmpty,
    SourceNotFound,
)
from platform_server.apps.collect.models import CollectSource
from platform_server.apps.collect.schemas import (
    SourceCreateIn,
    SourceOut,
    SourceUpdateIn,
)
from platform_server.apps.collect.services.changes import given_changes
from platform_server.apps.collect.services.presenters import to_source_out

_logger = get_logger("platform.collect.source")

# 凭据在库里的占位。⚠ 一期还没有密钥管理，先存一个不可逆的标记而不是明文：
# 存明文一旦上线就再也收不回来，而标记至少让「配没配过」是诚实的
CREDENTIAL_PLACEHOLDER = "configured"


async def list_sources(
    session: AsyncSession,
    *,
    filters: tuple[str | None, str | None, bool | None],
    page: PageParams,
    sort: str | None,
) -> Page[SourceOut]:
    """数据源列表。点位计数批量查，不逐行发查询。

    Args: session, filters（关键字、协议、启用态）, page, sort。
    """
    keyword, protocol, is_enabled = filters
    statement = source_crud.order_by_whitelist(
        source_crud.build_query(
            keyword=keyword, protocol=protocol, is_enabled=is_enabled
        ),
        sort=sort,
        allowed=dict(SORTABLE),
        default=DEFAULT_ORDER,
    )
    rows, total = await source_crud.list_page(
        session, statement=statement, offset=page.offset, limit=page.size
    )
    counts = await source_crud.point_counts(
        session, frozenset(row.id for row in rows)
    )
    return Page[SourceOut](
        items=[
            to_source_out(row, point_count=counts.get(row.id, 0))
            for row in rows
        ],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_source(session: AsyncSession, source_id: uuid.UUID) -> SourceOut:
    """数据源详情。

    Args: session, source_id。
    """
    source = await require_source(session, source_id)
    return await _present(session, source)


async def create_source(
    session: AsyncSession, *, payload: SourceCreateIn
) -> SourceOut:
    """建数据源。编码撞了就 409，不静默改名。

    Args: session, payload。
    """
    if await source_crud.get_by_code(session, payload.code) is not None:
        raise SourceCodeTaken(f"数据源编码已被占用：{payload.code}")
    source = CollectSource(
        name=payload.name,
        code=payload.code,
        protocol=payload.protocol,
        endpoint=payload.endpoint,
        credential_enc=_credential_of(payload.credential is not None),
        options_json=dict(payload.options_json),
        read_mode=payload.read_mode,
        poll_interval_ms=payload.poll_interval_ms,
        is_enabled=payload.is_enabled,
    )
    source_crud.add(session, source)
    await session.flush()
    presented = await _present(session, source)
    await _commit(session)
    _logger.info(
        "collect_source_created", "数据源已创建", source_id=str(source.id)
    )
    return presented


async def update_source(
    session: AsyncSession, *, source_id: uuid.UUID, payload: SourceUpdateIn
) -> SourceOut:
    """改数据源。缺省的字段不动。

    Args: session, source_id, payload。
    """
    source = await require_source(session, source_id)
    changes = given_changes(payload)
    credential = changes.pop("credential", None)
    if "credential" in payload.model_fields_set:
        changes["credential_enc"] = _credential_of(credential is not None)
    source_crud.apply_changes(source, changes)
    await session.flush()
    presented = await _present(session, source)
    await _commit(session)
    _logger.info(
        "collect_source_updated", "数据源已更新", source_id=str(source.id)
    )
    return presented


async def delete_source(session: AsyncSession, *, source_id: uuid.UUID) -> None:
    """删数据源。下面还有点位时拒绝。

    ⚠ 不级联删点位：点位一走，绑着它的大屏就悄悄失去数据源，而删除操作本身
    看起来完全成功。点位要一条条删，每条都过绑定检查。
    Args: session, source_id。
    """
    source = await require_source(session, source_id)
    if await point_crud.count_by_source(session, source.id) > 0:
        raise SourceNotEmpty("这个数据源下还有点位，请先删除点位")
    _logger.info(
        "collect_source_deleted", "数据源已删除", source_id=str(source.id)
    )
    await source_crud.delete(session, source)
    await _commit(session)


async def require_source(
    session: AsyncSession, source_id: uuid.UUID
) -> CollectSource:
    """取数据源，取不到即 404。

    Args: session, source_id。
    """
    source = await source_crud.get(session, source_id)
    if source is None:
        raise SourceNotFound("数据源不存在")
    return source


async def _commit(session: AsyncSession) -> None:
    """就地提交。

    ⚠ 不能等依赖退出时再提交：计划变更通知紧跟在路由函数里发出，而 FastAPI 把
    「发响应」放在 yield 依赖的退出栈**里面**——不就地提交，collector 收到通知
    时重拉到的还是旧配置，而它不会再拉第二次。
    Args: session。
    """
    await session.commit()


def _credential_of(has_credential: bool) -> str | None:
    return CREDENTIAL_PLACEHOLDER if has_credential else None


async def _present(session: AsyncSession, source: CollectSource) -> SourceOut:
    counts = await source_crud.point_counts(session, frozenset({source.id}))
    return to_source_out(source, point_count=counts.get(source.id, 0))
