"""数据源管理面。事务边界在这一层：crud 不提交，api 不写业务。

⚠ 采集运行态一律在**事务外**补：它来自 collect schema 的另一条只读连接，
在业务事务里读它就是「事务内做外部 IO」（database-standard §6）。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from pydantic import SecretStr
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
from platform_server.apps.collect.services.credentials import CredentialCipher
from platform_server.apps.collect.services.presenters import (
    to_runtime_out,
    to_source_out,
)
from platform_server.apps.collect.services.state_source import (
    UNKNOWN,
    SourceStateSource,
)
from platform_server.apps.collect.services.transactions import (
    release_read_transaction,
)

_logger = get_logger("platform.collect.source")


@dataclass(frozen=True)
class SourceContext:
    """数据源面的旁路依赖：运行态读侧、实时值点位上限与口令加解密器。

    ⚠ 打成一包不是为了好看：函数形参上限是 5，而列表面本来就已经有
    「过滤 / 分页 / 排序」三件。
    """

    states: SourceStateSource
    live_point_limit: int
    cipher: CredentialCipher


async def list_sources(
    session: AsyncSession,
    context: SourceContext,
    *,
    filters: tuple[str | None, str | None, bool | None],
    page: PageParams,
    sort: str | None,
) -> Page[SourceOut]:
    """数据源列表。点位计数批量查，不逐行发查询。

    Args: session, context, filters（关键字、协议、启用态）, page, sort。
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
    items = [
        to_source_out(
            row,
            point_count=counts.get(row.id, 0),
            live_point_limit=context.live_point_limit,
        )
        for row in rows
    ]
    await release_read_transaction(session)
    return Page[SourceOut](
        items=await attach_runtime(context.states, items),
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_source(
    session: AsyncSession, context: SourceContext, source_id: uuid.UUID
) -> SourceOut:
    """数据源详情。

    Args: session, context, source_id。
    """
    source = await require_source(session, source_id)
    presented = await _present(session, source, context)
    await release_read_transaction(session)
    return (await attach_runtime(context.states, [presented]))[0]


async def attach_runtime(
    states: SourceStateSource, items: Sequence[SourceOut]
) -> list[SourceOut]:
    """把采集运行态贴到一批出参上。读不到的一律「还不知道」。

    ⚠ 只在事务外调用：它打的是 collect schema 的另一条连接。
    Args: states, items。
    """
    if not items:
        return []
    found = await states.read([item.id for item in items])
    return [
        item.model_copy(
            update={"runtime": to_runtime_out(found.get(item.id, UNKNOWN))}
        )
        for item in items
    ]


async def create_source(
    session: AsyncSession, context: SourceContext, *, payload: SourceCreateIn
) -> SourceOut:
    """建数据源。编码撞了就 409，不静默改名。

    Args: session, context, payload。
    """
    if await source_crud.get_by_code(session, payload.code) is not None:
        raise SourceCodeTaken(f"数据源编码已被占用：{payload.code}")
    source = CollectSource(
        name=payload.name,
        code=payload.code,
        description=payload.description,
        protocol=payload.protocol,
        endpoint=payload.endpoint,
        username=payload.username,
        credential_enc=_encrypted(context.cipher, payload.credential),
        options_json=dict(payload.options_json),
        read_mode=payload.read_mode,
        poll_interval_ms=payload.poll_interval_ms,
        is_enabled=payload.is_enabled,
    )
    source_crud.add(session, source)
    await session.flush()
    presented = await _present(session, source, context)
    await _commit(session)
    _logger.info(
        "collect_source_created", "数据源已创建", source_id=str(source.id)
    )
    return (await attach_runtime(context.states, [presented]))[0]


async def update_source(
    session: AsyncSession,
    context: SourceContext,
    *,
    source_id: uuid.UUID,
    payload: SourceUpdateIn,
) -> SourceOut:
    """改数据源。缺省的字段不动。

    Args: session, context, source_id, payload。
    """
    source = await require_source(session, source_id)
    changes = given_changes(payload)
    credential = changes.pop("credential", None)
    if "credential" in payload.model_fields_set:
        changes["credential_enc"] = _encrypted(context.cipher, credential)
    source_crud.apply_changes(source, changes)
    await session.flush()
    presented = await _present(session, source, context)
    await _commit(session)
    _logger.info(
        "collect_source_updated", "数据源已更新", source_id=str(source.id)
    )
    return (await attach_runtime(context.states, [presented]))[0]


async def delete_source(
    session: AsyncSession, *, source_id: uuid.UUID, is_forced: bool = False
) -> None:
    """删数据源。下面还有点位时拒绝；`is_forced` 连点位一起删。

    ⚠ 默认不级联删点位：点位一走，绑着它的大屏就悄悄失去数据源，而删除操作
    本身看起来完全成功。点位要一条条删，每条都过绑定检查。
    ⚠ `is_forced` 是显式跳过这道守卫：点位随外键 CASCADE 一起删，仍绑着它们
    的大屏引用就此失效——界面要在二次确认里把这句话说出来。
    Args: session, source_id, is_forced。
    """
    source = await require_source(session, source_id)
    point_count = await point_crud.count_by_source(session, source.id)
    if point_count > 0 and not is_forced:
        raise SourceNotEmpty("这个数据源下还有点位，请先删除点位")
    _logger.info(
        "collect_source_deleted",
        "数据源已删除",
        source_id=str(source.id),
        point_count=point_count,
        is_forced=is_forced,
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


def _encrypted(cipher: CredentialCipher, credential: object) -> str | None:
    """口令入库前加密；没给或清空就是 None。

    Args: cipher, credential（`SecretStr` 或 None）。
    """
    if not isinstance(credential, SecretStr):
        return None
    return cipher.encrypt(credential.get_secret_value())


async def _present(
    session: AsyncSession, source: CollectSource, context: SourceContext
) -> SourceOut:
    counts = await source_crud.point_counts(session, frozenset({source.id}))
    return to_source_out(
        source,
        point_count=counts.get(source.id, 0),
        live_point_limit=context.live_point_limit,
    )
