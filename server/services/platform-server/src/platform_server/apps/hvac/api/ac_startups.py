"""开机事件面：事件列表、批次与人工排除。读 `ac:view`，写 `ac:manage`。

⚠ `:rebuild` 只入队：抽取一次要读几十万行外库数据，放进请求路径就是一个必然
超时的 HTTP 调用（ARCHITECTURE §3.4）。
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, CursorPage, CursorParams, cursor_params, ok
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.crud import EpisodePage
from platform_server.apps.hvac.deps import (
    Dispatcher,
    get_ac_source_reader,
    get_caller,
    get_dispatcher,
    get_session,
    require,
)
from platform_server.apps.hvac.schemas import (
    StartupBatchesOut,
    StartupEpisodeOut,
    StartupExclusionIn,
    StartupExclusionOut,
    StartupRebuildIn,
    StartupRebuildOut,
)
from platform_server.apps.hvac.services import (
    ac_startup_query,
    ac_startup_service,
)
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=API_PREFIX, tags=["ac-startups"])


def episode_filters(
    outcome: Annotated[str | None, Query()] = None,
    running_set: Annotated[str | None, Query()] = None,
) -> EpisodePage:
    """把两个过滤参数收成一个条件对象。

    Args: outcome, running_set（逗号分隔的空调序号）。
    """
    return ac_startup_query.parse_filters(outcome, running_set)


SessionDep = Annotated[AsyncSession, Depends(get_session)]
ReaderDep = Annotated[AcSourceReader, Depends(get_ac_source_reader)]
CursorDep = Annotated[CursorParams, Depends(cursor_params)]
FiltersDep = Annotated[EpisodePage, Depends(episode_filters)]
DispatchDep = Annotated[Dispatcher, Depends(get_dispatcher)]
CallerDep = Annotated[CallerContext, Depends(get_caller)]
ViewDep = Annotated[CallerContext, Depends(require(AC_VIEW))]
ManageDep = Annotated[CallerContext, Depends(require(AC_MANAGE))]
# ⚠ 路径里的时刻按 UTC 的 Z 后缀写（`2026-01-31T23:40:00Z`）：带 `+08:00`
# 的写法里那个 `+` 在 URL 里必须转义成 %2B，不转义会被解成空格
StartedAtDep = Annotated[datetime, Path()]


@router.get(
    "/rooms/{room_id}/startup-episodes",
    response_model=ApiResponse[CursorPage[StartupEpisodeOut]],
    summary="开机事件列表",
)
async def list_startup_episodes(
    room_id: uuid.UUID,
    session: SessionDep,
    cursor: CursorDep,
    filters: FiltersDep,
    _viewer: ViewDep,
) -> ApiResponse[CursorPage[StartupEpisodeOut]]:
    """当前批次里的开机事件，最新的在前。没算过的房间返回空页而不是 404。

    Args: room_id, session, cursor, filters, _viewer。
    """
    page = await ac_startup_query.list_episodes(
        session, room_id=room_id, cursor=cursor, filters=filters
    )
    return ok(page)


@router.get(
    "/rooms/{room_id}/startup-batches",
    response_model=ApiResponse[StartupBatchesOut],
    summary="抽取批次与组合覆盖度",
)
async def list_startup_batches(
    room_id: uuid.UUID,
    session: SessionDep,
    reader: ReaderDep,
    _viewer: ViewDep,
) -> ApiResponse[StartupBatchesOut]:
    """批次列表、当前批次、进度、组合覆盖度、数据范围与指纹是否过期。

    Args: room_id, session, reader, _viewer。
    """
    summary = await ac_startup_query.list_batches(
        session, reader, room_id=room_id, rules=ExtractionRules()
    )
    return ok(summary)


@router.post(
    "/rooms/{room_id}/startup-batches:rebuild",
    response_model=ApiResponse[StartupRebuildOut],
    status_code=status.HTTP_202_ACCEPTED,
    summary="重算开机事件（入队）",
)
async def rebuild_startup_batches(
    room_id: uuid.UUID,
    payload: StartupRebuildIn,
    session: SessionDep,
    reader: ReaderDep,
    dispatcher: DispatchDep,
    _manager: ManageDep,
) -> ApiResponse[StartupRebuildOut]:
    """建一个新批次并把分片排进队列，立刻返回批次 id。

    Args: room_id, payload, session, reader, dispatcher, _manager。
    """
    resolved = await ac_startup_service.resolve_window(
        session, reader, room_id=room_id, asked=payload
    )
    plan = await _queue(session, room_id=room_id, resolved=resolved)
    dispatcher.after_commit(plan.dispatch())
    return ok(_to_rebuild_out(plan, resolved), message="重算已排队")


async def _queue(
    session: AsyncSession,
    *,
    room_id: uuid.UUID,
    resolved: ac_startup_service.ResolvedWindow,
) -> ac_startup_service.RebuildPlan:
    """按定下来的区间建批次与分片行。

    Args: session, room_id, resolved。
    """
    return await ac_startup_service.request_rebuild(
        session,
        room_id=room_id,
        window=resolved.window,
        rules=ExtractionRules(),
    )


def _to_rebuild_out(
    plan: ac_startup_service.RebuildPlan,
    resolved: ac_startup_service.ResolvedWindow,
) -> StartupRebuildOut:
    """入队计划 → 对外模型。回显的是**实际排进队列**的那一段。

    Args: plan, resolved。
    """
    return StartupRebuildOut(
        batch_id=plan.batch.id,
        status=plan.batch.status,
        shard_total=plan.batch.shard_total,
        window_start=resolved.window.start,
        window_end=resolved.window.end,
        is_clamped=resolved.is_clamped,
    )


@router.put(
    "/rooms/{room_id}/startup-exclusions/{started_at}",
    response_model=ApiResponse[StartupExclusionOut],
    summary="人工排除一次开机",
)
async def put_startup_exclusion(
    room_id: uuid.UUID,
    started_at: StartedAtDep,
    payload: StartupExclusionIn,
    session: SessionDep,
    caller: CallerDep,
    _manager: ManageDep,
) -> ApiResponse[StartupExclusionOut]:
    """按自然键排除，重复调用是覆盖。排除人取自调用者身份。

    Args: room_id, started_at, payload, session, caller, _manager。
    """
    exclusion = await ac_startup_service.put_exclusion(
        session,
        room_id=room_id,
        started_at=started_at,
        payload=payload,
        excluded_by=caller.username,
    )
    return ok(StartupExclusionOut.model_validate(exclusion), message="已排除")


@router.delete(
    "/rooms/{room_id}/startup-exclusions/{started_at}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="取消人工排除",
)
async def delete_startup_exclusion(
    room_id: uuid.UUID,
    started_at: StartedAtDep,
    session: SessionDep,
    _manager: ManageDep,
) -> Response:
    """取消排除。没排除过也返回 204——DELETE 必须幂等。

    Args: room_id, started_at, session, _manager。
    """
    await ac_startup_service.delete_exclusion(
        session, room_id=room_id, started_at=started_at
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
