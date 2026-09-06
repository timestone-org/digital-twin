"""周期调度与中断任务收敛，唯一约束防止同期重复。"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError

from lib.logging import current_traceparent, get_logger
from platform_server.apps.report.crud import renders, schedules
from platform_server.apps.report.models import ReportRender
from platform_server.apps.report.schemas.common import Granularity
from platform_server.apps.report.schemas.jobs import ScheduleOut
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.period import (
    format_period,
    parse_period,
    shift,
)
from platform_server.apps.report.services.render_service import (
    MAX_PENDING_RENDERS,
    enqueue,
)
from platform_server.apps.report.services.template_service import (
    record_audit,
    require_template,
)
from platform_server.apps.report.services.worker import WorkerOptions

_logger = get_logger("platform.report.scheduler")
_PAGE_SIZE = 100


def due_period(
    now: datetime, granularity: Granularity, delay_hours: int, timezone: str
) -> str:
    """最近完整报告期。Args: now, granularity, delay_hours, timezone。"""
    local = (now - timedelta(hours=delay_hours)).astimezone(ZoneInfo(timezone))
    start = parse_period(format_period(local, granularity), granularity)
    return format_period(shift(start, granularity, -1), granularity)


def next_due_period(
    rule: ScheduleOut, now: datetime, timezone: str
) -> str | None:
    """每拍补一期，水位只前进。Args: rule, now, timezone。"""
    latest = due_period(now, rule.granularity, rule.delay_hours, timezone)
    if rule.last_run_period is None:
        return latest
    last = parse_period(rule.last_run_period, rule.granularity)
    following = format_period(
        shift(last, rule.granularity, 1), rule.granularity
    )
    return following if following <= latest else None


class ReportScheduler:
    """一分钟一拍，有界扫描规则。"""

    def __init__(
        self, options: WorkerOptions, timezone: str, is_enabled: bool
    ) -> None:
        self._options = options
        self._timezone = timezone
        self._enabled = is_enabled
        self._stop = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()

    def stop(self) -> None:
        self._stop.set()

    async def drain(self, timeout_s: float) -> None:
        try:
            async with asyncio.timeout(timeout_s):
                await self._idle.wait()
        except TimeoutError:
            _logger.warning(
                "report_scheduler_drain_timeout", "报告调度未在宽限期内完成"
            )

    async def run(self) -> None:
        while not self._stop.is_set():
            self._idle.clear()
            try:
                await self.tick(datetime.now(UTC))
            except Exception as error:
                _logger.error(
                    "report_scheduler_failed", "报告调度失败", error=error
                )
            finally:
                self._idle.set()
            try:
                async with asyncio.timeout(60):
                    await self._stop.wait()
            except TimeoutError:
                continue

    async def tick(self, now: datetime) -> None:
        """收敛中断任务，再触发到期规则。Args: now。"""
        async with self._options.database.session() as session:
            stale = await renders.stale(
                session,
                now - timedelta(seconds=self._options.timeout_s + 120),
                _PAGE_SIZE,
            )
            for row in stale:
                row.status = "failed"
                row.error = "生成任务中断或未能投递，请重新生成"
                row.finished_at = now
        if not self._enabled:
            return
        after: uuid.UUID | None = None
        while not self._stop.is_set():
            async with self._options.database.session() as session:
                page = await schedules.enabled_page(session, after, _PAGE_SIZE)
                rules = [ScheduleOut.model_validate(row) for row in page]
            for rule in rules:
                if self._stop.is_set():
                    return
                try:
                    await self._schedule(rule, now)
                except Exception as error:
                    _logger.error(
                        "report_schedule_failed",
                        "一条报告规则调度失败",
                        schedule_id=str(rule.id),
                        error=error,
                    )
            if len(rules) < _PAGE_SIZE:
                break
            after = rules[-1].id

    async def _schedule(self, rule: ScheduleOut, now: datetime) -> None:
        period = next_due_period(rule, now, self._timezone)
        if period is None:
            return
        async with self._options.database.session() as session:
            if await renders.active_count(session) >= MAX_PENDING_RENDERS:
                return
            template = await require_template(session, rule.template_id)
            if not template.is_enabled:
                return
            body = TemplateBody.model_validate(template.body_json)
            body.granularity = rule.granularity
            row = ReportRender(
                template_id=rule.template_id,
                schedule_id=rule.id,
                period=period,
                granularity=rule.granularity,
                timezone=self._timezone,
                kind="render",
                snapshot_json=body.model_dump(),
                traceparent=current_traceparent(),
                created_by="scheduler",
            )
            try:
                async with session.begin_nested():
                    await renders.add(session, row)
            except IntegrityError:
                return
            stored = await schedules.get(session, rule.id)
            if stored is not None:
                stored.last_run_period = period
            record_audit(
                session,
                "scheduler",
                "render_scheduled",
                row.id,
                (None, {"period": period}),
            )
            enqueue(session, row, self._options.stream)
