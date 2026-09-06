"""任务提交、读取与下载；生成只在 worker 执行。"""

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.db import after_commit
from lib.logging import current_traceparent
from lib.objectstore import ObjectStore
from lib.stream import StreamLike
from lib.web import CursorPage, CursorParams, decode_cursor, encode_cursor
from platform_server.apps.report.catalog import REPORT_MANAGE, REPORT_RENDER
from platform_server.apps.report.crud import renders
from platform_server.apps.report.errors import (
    ReportConflict,
    ReportInvalid,
    ReportNotFound,
    ReportQueueFull,
    ReportUnavailable,
)
from platform_server.apps.report.models import ReportRender
from platform_server.apps.report.schemas.jobs import (
    ImportResultOut,
    RenderCreateIn,
    RenderDetailOut,
    RenderOut,
)
from platform_server.apps.report.schemas.preview import PreviewOut
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.period import parse_period
from platform_server.apps.report.services.template_service import (
    record_audit,
    require_template,
    require_valid,
)

CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)
STREAM = "platform:report:jobs"
GROUP = "report-workers"
MAX_KEY_LENGTH = 200
MAX_PENDING_RENDERS = 100


@dataclass(frozen=True)
class RenderContext:
    """提交者与队列。"""

    actor: str
    stream: StreamLike
    timezone: str
    idempotency_key: str | None = None


def output(row: ReportRender) -> RenderOut:
    return RenderOut.model_validate(
        {
            **{
                name: getattr(row, name)
                for name in RenderOut.model_fields
                if name != "warnings"
            },
            "warnings": row.warnings_json,
        }
    )


async def start_render(
    session: AsyncSession, payload: RenderCreateIn, context: RenderContext
) -> RenderOut:
    """冻结模板并创建幂等任务。Args: session, payload, context。"""
    cached = await cached_request(
        session, payload.model_dump(mode="json"), context, "render"
    )
    if cached is not None:
        return cached
    if await renders.active_count(session) >= MAX_PENDING_RENDERS:
        raise ReportQueueFull("报告队列繁忙，请稍后再生成")
    template = await require_template(session, payload.template_id)
    if not template.is_enabled:
        raise ReportInvalid("模板已停用")
    body = TemplateBody.model_validate(template.body_json)
    if payload.granularity:
        body.granularity = payload.granularity
    require_valid(body)
    try:
        parse_period(payload.period, body.granularity)
    except ValueError as error:
        raise ReportInvalid(str(error)) from error
    row = ReportRender(
        template_id=template.id,
        period=payload.period,
        granularity=body.granularity,
        timezone=context.timezone,
        snapshot_json=body.model_dump(),
        traceparent=current_traceparent(),
        created_by=context.actor,
        kind="render",
    )
    return await _save_request(
        session, row, payload.model_dump(mode="json"), context
    )


async def _save_request(
    session: AsyncSession,
    row: ReportRender,
    payload: dict[str, object],
    context: RenderContext,
) -> RenderOut:
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode()
    ).hexdigest()
    key = context.idempotency_key
    if key is not None:
        if not 1 <= len(key) <= MAX_KEY_LENGTH:
            raise ReportInvalid("幂等键长度必须为 1 至 200")
        row.request_key = hashlib.sha256(
            f"{context.actor}:{row.kind}:{key}".encode()
        ).hexdigest()
        row.request_hash = digest
    try:
        async with session.begin_nested():
            await renders.add(session, row)
    except IntegrityError as error:
        existing = (
            await renders.by_request(session, row.request_key)
            if row.request_key
            else None
        )
        if existing is None or existing.request_hash != digest:
            raise ReportConflict("幂等键已用于其他生成参数") from error
        return accepted_output(existing)
    record_audit(
        session,
        context.actor,
        "render_requested",
        row.id,
        (None, {"period": row.period}),
    )
    enqueue(session, row, context.stream)
    return output(row)


def accepted_output(row: ReportRender) -> RenderOut:
    return output(row).model_copy(
        update={
            "status": "pending",
            "warnings": [],
            "error": None,
            "started_at": None,
            "finished_at": None,
        }
    )


async def cached_request(
    session: AsyncSession,
    payload: dict[str, object],
    context: RenderContext,
    kind: str,
) -> RenderOut | None:
    key = context.idempotency_key
    if key is None:
        return None
    if not 1 <= len(key) <= MAX_KEY_LENGTH:
        raise ReportInvalid("幂等键长度必须为 1 至 200")
    request_key = hashlib.sha256(
        f"{context.actor}:{kind}:{key}".encode()
    ).hexdigest()
    existing = await renders.by_request(session, request_key)
    if existing is None:
        return None
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode()
    ).hexdigest()
    if existing.request_hash != digest:
        raise ReportConflict("幂等键已用于其他生成参数")
    return accepted_output(existing)


def enqueue(
    session: AsyncSession, row: ReportRender, stream: StreamLike
) -> None:
    fields = {
        "envelope_version": "1",
        "render_id": str(row.id),
        "traceparent": row.traceparent,
        "idempotency_key": str(row.id),
    }

    async def publish() -> None:
        """提交后投递带 traceparent 的任务信封。"""
        await stream.publish(STREAM, fields)

    after_commit(session, publish)


async def read_render(
    session: AsyncSession, render_id: uuid.UUID, caller: CallerContext
) -> RenderDetailOut:
    row = await require_render(session, render_id)
    details = RenderDetailOut(**output(row).model_dump())
    if row.result_json:
        if (
            row.kind == "import"
            and row.created_by == str(caller.user_id)
            and REPORT_MANAGE in caller.permissions
        ):
            details.imported = ImportResultOut.model_validate(row.result_json)
        elif row.kind == "render" and caller.has_any(
            frozenset((REPORT_RENDER, REPORT_MANAGE))
        ):
            details.preview = PreviewOut.model_validate(row.result_json)
    return details


async def require_render(
    session: AsyncSession, render_id: uuid.UUID
) -> ReportRender:
    row = await renders.get(session, render_id)
    if row is None:
        raise ReportNotFound("生成记录不存在")
    return row


async def list_renders(
    session: AsyncSession, template_id: uuid.UUID | None, page: CursorParams
) -> CursorPage[RenderOut]:
    anchor = _anchor(page.after)
    rows = await renders.page(session, template_id, anchor, page.limit)
    has_more = len(rows) > page.limit
    kept = rows[: page.limit]
    next_cursor = (
        encode_cursor(
            {"at": kept[-1].created_at.isoformat(), "id": str(kept[-1].id)}
        )
        if has_more
        else None
    )
    return CursorPage[RenderOut](
        items=[output(row) for row in kept], next=next_cursor, has_more=has_more
    )


def _anchor(after: str | None) -> tuple[datetime, uuid.UUID] | None:
    if after is None:
        return None
    payload = decode_cursor(after)
    try:
        stamp = datetime.fromisoformat(payload["at"])
        if stamp.tzinfo is None:
            raise ValueError("游标时刻缺少时区")
        return stamp, uuid.UUID(payload["id"])
    except (KeyError, ValueError) as error:
        raise ReportInvalid("生成记录游标不可解析") from error


async def download(
    session: AsyncSession, render_id: uuid.UUID, store: ObjectStore, actor: str
) -> bytes:
    """事务外下载。Args: session, render_id, store, actor。"""
    row = await require_render(session, render_id)
    if row.status != "succeeded" or row.kind != "render" or not row.object_key:
        raise ReportUnavailable("报告尚未生成成功")
    object_key = row.object_key
    record_audit(session, actor, "render_downloaded", row.id, (None, None))
    await session.commit()
    return await store.get_bytes(object_key)


async def start_import(
    session: AsyncSession, source_key: str, context: RenderContext
) -> RenderOut:
    """登记已校验原件的导入任务。Args: session, source_key, context。"""
    cached = await cached_request(
        session, {"object_key": source_key}, context, "import"
    )
    if cached is not None:
        return cached
    if await renders.active_count(session) >= MAX_PENDING_RENDERS:
        raise ReportQueueFull("报告队列繁忙，请稍后再导入")
    row = ReportRender(
        period="",
        granularity="month",
        timezone=context.timezone,
        kind="import",
        snapshot_json={},
        traceparent=current_traceparent(),
        created_by=context.actor,
        object_key=source_key,
    )
    return await _save_request(
        session, row, {"object_key": source_key}, context
    )
