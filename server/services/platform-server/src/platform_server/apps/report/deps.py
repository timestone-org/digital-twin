"""报告操作的权限与调用上下文。"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends

from lib.auth import CallerContext
from lib.objectstore import ObjectStore
from lib.stream import StreamLike
from platform_server.apps.report.catalog import (
    REPORT_MANAGE,
    REPORT_RENDER,
    REPORT_SCHEDULE,
)
from platform_server.apps.report.services.render_service import RenderContext
from platform_server.container import Container
from platform_server.deps import (
    WriteGate,
    get_container,
    get_idempotency_key,
    get_object_store,
    get_stream,
    require,
)


@dataclass(frozen=True)
class ReportManageGate(WriteGate):
    """报告管理上下文与外部端口。"""

    store: ObjectStore
    stream: StreamLike
    timezone: str


def manage_gate(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(REPORT_MANAGE))],
    key: Annotated[str | None, Depends(get_idempotency_key)],
    store: Annotated[ObjectStore, Depends(get_object_store)],
    stream: Annotated[StreamLike, Depends(get_stream)],
) -> ReportManageGate:
    return ReportManageGate(
        idempotency=container.idempotency,
        idempotency_key=key,
        caller=caller,
        store=store,
        stream=stream,
        timezone=container.settings.dataset_bucket_timezone,
    )


def schedule_gate(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(REPORT_SCHEDULE))],
    key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteGate:
    return WriteGate(
        idempotency=container.idempotency, idempotency_key=key, caller=caller
    )


def render_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(REPORT_RENDER))],
    key: Annotated[str | None, Depends(get_idempotency_key)],
    stream: Annotated[StreamLike, Depends(get_stream)],
) -> RenderContext:
    return RenderContext(
        actor=str(caller.user_id),
        stream=stream,
        timezone=container.settings.dataset_bucket_timezone,
        idempotency_key=key,
    )
