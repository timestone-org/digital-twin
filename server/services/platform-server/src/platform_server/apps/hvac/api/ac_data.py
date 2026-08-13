"""数据集目录、数据源绑定与达标范围。读用 `ac:view`，写用 `ac:manage`。

绑定与达标范围都是**覆盖式**的 `PUT`：同一台空调的同一个数据集只有一条绑定，
同一个指标只有一条达标范围，重复调用是覆盖而不是新增。
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, CursorPage, CursorParams, cursor_params, ok
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.deps import (
    get_ac_source_reader,
    get_session,
    require,
)
from platform_server.apps.hvac.schemas import (
    DEFAULT_SERIES_POINTS,
    MAX_SERIES_POINTS,
    MIN_SERIES_POINTS,
    AcDataBindingOut,
    AcDataBindingPutIn,
    AcDataBindingsOut,
    DatasetsOut,
    LiveReadingsOut,
    MetricLimitsOut,
    MetricLimitsPutIn,
    RawSampleOut,
    RawSeriesOut,
    SeriesOptions,
    SourceObjectsOut,
    TimeWindow,
)
from platform_server.apps.hvac.services import (
    ac_data_service,
    ac_live_readings,
    ac_reading_service,
)
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=API_PREFIX, tags=["ac-data"])


def time_window(
    range_from: Annotated[datetime, Query(alias="from")],
    range_to: Annotated[datetime, Query(alias="to")],
) -> TimeWindow:
    """把区间两端收成一个值对象。

    ⚠ 形参不能叫 `from`，那是 Python 关键字；对外的参数名靠 alias 保持契约。
    Args: range_from, range_to。
    """
    return TimeWindow(start=range_from, end=range_to)


def series_options(
    metrics: str,
    max_points: Annotated[
        int, Query(ge=MIN_SERIES_POINTS, le=MAX_SERIES_POINTS)
    ] = DEFAULT_SERIES_POINTS,
) -> SeriesOptions:
    """把折线图的两个 query 参数收成一个选项对象。

    Args: metrics（逗号分隔）, max_points。
    """
    return SeriesOptions(metrics=metrics, max_points=max_points)


SessionDep = Annotated[AsyncSession, Depends(get_session)]
ReaderDep = Annotated[AcSourceReader, Depends(get_ac_source_reader)]
WindowDep = Annotated[TimeWindow, Depends(time_window)]
CursorDep = Annotated[CursorParams, Depends(cursor_params)]
SeriesDep = Annotated[SeriesOptions, Depends(series_options)]
ViewDep = Annotated[CallerContext, Depends(require(AC_VIEW))]
ManageDep = Annotated[CallerContext, Depends(require(AC_MANAGE))]


@router.get(
    "/ac-datasets",
    response_model=ApiResponse[DatasetsOut],
    summary="数据集目录",
)
async def list_datasets(_viewer: ViewDep) -> ApiResponse[DatasetsOut]:
    """可看的数据集与它们的指标。加数据集时前端不用改。

    Args: _viewer。
    """
    return ok(ac_data_service.list_datasets())


@router.get(
    "/ac-datasets/{dataset}/source-objects",
    response_model=ApiResponse[SourceObjectsOut],
    summary="可绑定的数据源对象",
)
async def list_source_objects(
    dataset: str, reader: ReaderDep, _manager: ManageDep
) -> ApiResponse[SourceObjectsOut]:
    """外库里列形状符合该数据集的对象。要 `ac:manage`——它暴露外库的结构。

    Args: dataset, reader, _manager。
    """
    return ok(
        await ac_reading_service.list_source_objects(reader, dataset=dataset)
    )


@router.get(
    "/ac-units/{ac_unit_id}/raw-samples",
    response_model=ApiResponse[CursorPage[RawSampleOut]],
    summary="原始数据表格",
)
async def list_raw_samples(
    ac_unit_id: uuid.UUID,
    session: SessionDep,
    reader: ReaderDep,
    window: WindowDep,
    cursor: CursorDep,
    _viewer: ViewDep,
) -> ApiResponse[CursorPage[RawSampleOut]]:
    """区间内的逐行原始数据，游标翻页。

    Args: ac_unit_id, session, reader, window, cursor, _viewer。
    """
    page = await ac_reading_service.list_raw_samples(
        session, reader, ac_unit_id=ac_unit_id, window=window, cursor=cursor
    )
    return ok(page)


@router.get(
    "/ac-units/{ac_unit_id}/raw-series",
    response_model=ApiResponse[RawSeriesOut],
    summary="原始数据的聚合序列",
)
async def list_raw_series(
    ac_unit_id: uuid.UUID,
    session: SessionDep,
    reader: ReaderDep,
    window: WindowDep,
    options: SeriesDep,
    _viewer: ViewDep,
) -> ApiResponse[RawSeriesOut]:
    """按分钟桶聚合的折线图数据，桶宽在响应里回显。

    Args: ac_unit_id, session, reader, window, options, _viewer。
    """
    series = await ac_reading_service.list_raw_series(
        session, reader, ac_unit_id=ac_unit_id, window=window, options=options
    )
    return ok(series)


@router.get(
    "/rooms/{room_id}/live-readings",
    response_model=ApiResponse[LiveReadingsOut],
    summary="房间机组的当下读数",
)
async def read_live_readings(
    room_id: uuid.UUID,
    session: SessionDep,
    reader: ReaderDep,
    _viewer: ViewDep,
) -> ApiResponse[LiveReadingsOut]:
    """房间里每台绑了原始数据的机组在回看窗内的最后一条可用读数。

    Args: room_id, session, reader, _viewer。
    """
    return ok(
        await ac_live_readings.read_live(session, reader, room_id=room_id)
    )


@router.get(
    "/ac-units/{ac_unit_id}/data-bindings",
    response_model=ApiResponse[AcDataBindingsOut],
    summary="空调的数据源绑定",
)
async def list_bindings(
    ac_unit_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[AcDataBindingsOut]:
    """一台空调绑了哪些数据源。

    Args: ac_unit_id, session, _viewer。
    """
    return ok(
        await ac_data_service.list_bindings(session, ac_unit_id=ac_unit_id)
    )


@router.put(
    "/ac-units/{ac_unit_id}/data-bindings/{dataset}",
    response_model=ApiResponse[AcDataBindingOut],
    summary="设置数据源绑定",
)
async def put_binding(
    ac_unit_id: uuid.UUID,
    dataset: str,
    payload: AcDataBindingPutIn,
    session: SessionDep,
    reader: ReaderDep,
    _manager: ManageDep,
) -> ApiResponse[AcDataBindingOut]:
    """把这台空调的这个数据集指向外部库里的一个对象。

    Args: ac_unit_id, dataset, payload, session, reader, _manager。
    """
    binding = await ac_data_service.put_binding(
        session,
        reader,
        ac_unit_id=ac_unit_id,
        dataset=dataset,
        payload=payload,
    )
    return ok(binding, message="数据源绑定已设置")


@router.delete(
    "/ac-units/{ac_unit_id}/data-bindings/{dataset}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="解除数据源绑定",
)
async def delete_binding(
    ac_unit_id: uuid.UUID,
    dataset: str,
    session: SessionDep,
    _manager: ManageDep,
) -> Response:
    """解除绑定。没绑过也返回 204——DELETE 必须幂等。

    Args: ac_unit_id, dataset, session, _manager。
    """
    await ac_data_service.delete_binding(
        session, ac_unit_id=ac_unit_id, dataset=dataset
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/ac-units/{ac_unit_id}/metric-limits",
    response_model=ApiResponse[MetricLimitsOut],
    summary="空调的达标范围",
)
async def list_metric_limits(
    ac_unit_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[MetricLimitsOut]:
    """一台空调各指标的上下限。

    Args: ac_unit_id, session, _viewer。
    """
    return ok(
        await ac_data_service.list_metric_limits(session, ac_unit_id=ac_unit_id)
    )


@router.put(
    "/ac-units/{ac_unit_id}/metric-limits",
    response_model=ApiResponse[MetricLimitsOut],
    summary="设置达标范围",
)
async def put_metric_limits(
    ac_unit_id: uuid.UUID,
    payload: MetricLimitsPutIn,
    session: SessionDep,
    _manager: ManageDep,
) -> ApiResponse[MetricLimitsOut]:
    """覆盖式设置达标范围。请求里没出现的指标视为清除。

    Args: ac_unit_id, payload, session, _manager。
    """
    limits = await ac_data_service.put_metric_limits(
        session, ac_unit_id=ac_unit_id, payload=payload
    )
    return ok(limits, message="达标范围已设置")
