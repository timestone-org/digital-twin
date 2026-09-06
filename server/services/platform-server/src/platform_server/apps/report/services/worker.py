"""报告队列消费者，短事务取数与子进程生成相互分离。"""

import asyncio
import time
import uuid
from collections.abc import Mapping
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from multiprocessing.process import BaseProcess
from typing import Protocol, cast

from lib.logging import (
    bind_log_context,
    get_logger,
    parse_traceparent,
    reset_log_context,
)
from lib.objectstore import ObjectStore
from lib.stream import StreamGroup, StreamLike
from platform_server.apps.dataset.services import Sessions
from platform_server.apps.report.crud import renders
from platform_server.apps.report.schemas.preview import PreviewOut
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.metrics import PreviewContext
from platform_server.apps.report.services.preview import preview
from platform_server.apps.report.services.render_service import (
    CONTENT_TYPE,
    GROUP,
    STREAM,
)
from platform_server.apps.report.services.template_service import record_audit
from platform_server.apps.report.services.word_task import (
    WordTask,
    WordTaskResult,
    run_task,
)

_logger = get_logger("platform.report.worker")


class WordRunner(Protocol):
    """Word 子进程执行端口。"""

    async def run(
        self, task: WordTask, timeout_s: float, /
    ) -> WordTaskResult: ...


class WordPool:
    """Word 专用进程池，超时销毁实际执行进程。"""

    def __init__(self) -> None:
        self._pool = ProcessPoolExecutor(max_workers=1)

    async def run(self, task: WordTask, timeout_s: float) -> WordTaskResult:
        try:
            async with asyncio.timeout(timeout_s):
                return await asyncio.get_running_loop().run_in_executor(
                    self._pool, run_task, task
                )
        except BaseException:
            self.close()
            self._pool = ProcessPoolExecutor(max_workers=1)
            raise

    def close(self) -> None:
        # Python 3.12 没有公开的 kill_workers；仅在此处收敛 CPython 边界。
        processes = cast(
            dict[int, BaseProcess] | None, vars(self._pool).get("_processes")
        )
        for process in list(processes.values() if processes else ()):
            process.kill()
        self._pool.shutdown(wait=False, cancel_futures=True)


@dataclass(frozen=True)
class WorkerOptions:
    """消费者依赖。"""

    database: Sessions
    stream: StreamLike
    store: ObjectStore
    consumer: str
    timeout_s: float = 300


class ReportWorker:
    """报告任务的可关停消费循环。"""

    def __init__(self, options: WorkerOptions, pool: WordRunner) -> None:
        self._options = options
        self._pool = pool
        self._stopping = False
        self._idle = asyncio.Event()
        self._idle.set()

    def stop(self) -> None:
        self._stopping = True

    async def drain(self, timeout_s: float) -> None:
        try:
            async with asyncio.timeout(timeout_s):
                await self._idle.wait()
        except TimeoutError:
            _logger.warning(
                "report_drain_timeout",
                "报告未在关停宽限期内完成，保留待确认消息",
            )

    async def run(self) -> None:
        target = StreamGroup(
            stream=STREAM, group=GROUP, consumer=self._options.consumer
        )
        await self._options.stream.ensure_group(target)
        while not self._stopping:
            try:
                await self._tick(target)
            except Exception as error:
                _logger.error(
                    "report_consumer_failed", "报告消费失败", error=error
                )
                await asyncio.sleep(1)

    async def _tick(self, target: StreamGroup) -> None:
        stream = self._options.stream
        entries = await stream.claim_stale(
            target,
            min_idle_ms=int((self._options.timeout_s + 60) * 1000),
            count=1,
        )
        if not entries:
            entries = await stream.read_group(target, count=1, block_ms=1000)
        for entry in entries:
            if self._stopping:
                return
            token = bind_log_context(
                trace_id=parse_traceparent(entry.fields.get("traceparent"))
            )
            self._idle.clear()
            try:
                await self._handle(entry.fields)
                await stream.ack(target, entry.entry_id)
            finally:
                reset_log_context(token)
                self._idle.set()

    async def _handle(self, fields: Mapping[str, str]) -> None:
        try:
            if fields.get("envelope_version") != "1" or not fields.get(
                "traceparent"
            ):
                raise ValueError("无效信封")
            render_id = uuid.UUID(fields.get("render_id", ""))
        except ValueError:
            _logger.error("report_message_invalid", "报告消息无法解析")
            return
        started = time.monotonic()
        try:
            if await self.execute(render_id):
                _logger.info(
                    "report_generation_finished",
                    "报告生成完成",
                    render_id=str(render_id),
                    duration_ms=int((time.monotonic() - started) * 1000),
                )
        except Exception as error:
            _logger.error(
                "report_generation_failed",
                "报告生成失败",
                render_id=str(render_id),
                error=error,
            )
            async with self._options.database.session() as session:
                await renders.finish(
                    session,
                    render_id,
                    {
                        "status": "failed",
                        "error": "生成失败，请检查报告配置或联系管理员",
                        "finished_at": datetime.now(UTC),
                    },
                )

    async def execute(self, render_id: uuid.UUID) -> bool:
        """原子认领、取数、出事务、生成、入库。Args: render_id。"""
        options = self._options
        async with options.database.session() as session:
            row = await renders.claim(session, render_id, datetime.now(UTC))
            if row is None:
                return False
            kind, source_key, actor = row.kind, row.object_key, row.created_by
            snapshot, period, timezone = (
                row.snapshot_json,
                row.period,
                row.timezone,
            )
        async with asyncio.timeout(options.timeout_s):
            if kind == "import":
                if source_key is None:
                    raise ValueError("导入任务缺少文件")
                task = WordTask(
                    source=await options.store.get_bytes(source_key)
                )
                preview_result = None
            else:
                template = TemplateBody.model_validate(snapshot)
                async with options.database.session() as session:
                    preview_result = await preview(
                        session,
                        PreviewContext(
                            template=template, period=period, timezone=timezone
                        ),
                    )
                task = WordTask(template=template, preview=preview_result)
            result = await self._pool.run(task, options.timeout_s)
            return await self._save_result(
                render_id, result, preview_result, source_key, actor
            )

    async def _save_result(
        self,
        render_id: uuid.UUID,
        result: WordTaskResult,
        preview_result: PreviewOut | None,
        source_key: str | None,
        actor: str,
    ) -> bool:
        options = self._options
        object_key = (
            f"reports/renders/{render_id}.docx"
            if result.payload
            else source_key
        )
        if result.payload is not None and object_key is not None:
            await options.store.put_bytes(
                object_key, result.payload, content_type=CONTENT_TYPE
            )
        result_json = result_payload(result, preview_result)
        async with options.database.session() as session:
            completed = await renders.finish(
                session,
                render_id,
                {
                    "status": "succeeded",
                    "object_key": object_key,
                    "result_json": result_json,
                    "warnings_json": list(result.warnings),
                    "finished_at": datetime.now(UTC),
                },
            )
            if completed:
                record_audit(
                    session,
                    actor,
                    "render_generated",
                    render_id,
                    (
                        None,
                        {
                            "status": "succeeded",
                            "warning_count": len(result.warnings),
                        },
                    ),
                )
            return completed


def result_payload(
    result: WordTaskResult, preview_result: PreviewOut | None
) -> dict[str, object] | None:
    if result.imported is not None:
        return result.imported.model_dump(mode="json")
    return preview_result.model_dump(mode="json") if preview_result else None
