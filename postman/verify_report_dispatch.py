"""显式停止独立 Redis 容器，验证已提交报告在恢复后仅执行一次。"""

import argparse
import asyncio
import json
import sys
import uuid
from datetime import timedelta

from redis.asyncio import Redis
from sqlalchemy import delete, select

from lib.config import load_settings
from lib.db import Database
from lib.stream import RedisStream, StreamGroup
from lib.testing import FakeObjectStore
from lib.utils.timeutils import format_rfc3339
from platform_server.apps.report.crud import renders
from platform_server.apps.report.models import (
    ReportAudit,
    ReportRender,
    ReportTemplate,
)
from platform_server.apps.report.schemas.jobs import RenderCreateIn
from platform_server.apps.report.schemas.template import ReportTemplateCreateIn
from platform_server.apps.report.services import (
    dispatch,
    render_service,
    worker,
)
from platform_server.apps.report.services.dispatch import ReportDispatcher
from platform_server.apps.report.services.render_service import (
    RenderContext,
    start_render,
)
from platform_server.apps.report.services.template_service import (
    create_template,
)
from platform_server.apps.report.services.worker import (
    ReportWorker,
    WordPool,
    WorkerOptions,
)
from platform_server.settings import Settings

TEST_POSTGRES_PORT = 55433
TEST_REDIS_PORT = 56380


def check(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


async def docker(action: str, container: str) -> None:
    async with asyncio.timeout(20):
        process = await asyncio.create_subprocess_exec(
            "docker",
            action,
            container,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _output, error = await process.communicate()
    if process.returncode:
        raise RuntimeError(error.decode())


async def make_due(database: Database, identity: uuid.UUID) -> None:
    async with database.session() as session:
        row = await renders.get(session, identity)
        if row is None:
            raise RuntimeError("报告任务未提交")
        marker = dict((row.result_json or {}).get("_dispatch", {}))
        moment = await renders.dispatch_clock(session)
        marker["next_attempt_at"] = format_rfc3339(
            moment - timedelta(seconds=1)
        )
        row.result_json = {"_dispatch": marker}


async def verify(settings: Settings, container: str) -> dict[str, object]:
    if (
        settings.postgres_port != TEST_POSTGRES_PORT
        or settings.redis_port != TEST_REDIS_PORT
    ):
        raise RuntimeError("仅允许独立 PostgreSQL 55433 / Redis 56380 验证环境")
    if container != "dt-report-config-test-redis":
        raise RuntimeError("须明确指定独立验证 Redis 容器")
    database = Database(dsn=settings.dsn(), search_path="platform")
    stream = RedisStream(url=settings.url(), timeout_s=2)
    raw = Redis.from_url(settings.url(), decode_responses=True)
    queue = "report:manual-dispatch:" + uuid.uuid4().hex
    for module in (dispatch, render_service, worker):
        module.STREAM = queue
    actor = str(uuid.uuid4())
    async with database.session() as session:
        template = await create_template(
            session,
            ReportTemplateCreateIn(
                code="manual_" + uuid.uuid4().hex, name="Redis 停机恢复验证"
            ),
            actor,
        )
    try:
        return await outage(
            database, stream, raw, (template.id, actor), container
        )
    finally:
        async with database.session() as session:
            identities = select(ReportRender.id).where(
                ReportRender.template_id == template.id
            )
            await session.execute(
                delete(ReportAudit).where(ReportAudit.target_id.in_(identities))
            )
            await session.execute(
                delete(ReportAudit).where(ReportAudit.target_id == template.id)
            )
            await session.execute(
                delete(ReportRender).where(
                    ReportRender.template_id == template.id
                )
            )
            await session.execute(
                delete(ReportTemplate).where(ReportTemplate.id == template.id)
            )
        await raw.delete(queue)
        await raw.aclose()
        await stream.close()
        await database.dispose()


async def outage(database, stream, raw, identity, container):
    template_id, actor = identity
    try:
        await docker("stop", container)
        async with database.session() as session:
            accepted = await start_render(
                session,
                RenderCreateIn(template_id=template_id, period="2026-10"),
                RenderContext(actor=actor, stream=stream, timezone="UTC"),
            )
        await make_due(database, accepted.id)
        dispatcher = ReportDispatcher(database, stream)
        check(await dispatcher.tick() == 0, "Redis 停机时不应成功投递")
    finally:
        await docker("start", container)
    for _ in range(100):
        if await stream.ping():
            break
        await asyncio.sleep(0.1)
    else:
        raise RuntimeError("Redis 未在时限内恢复")
    await make_due(database, accepted.id)
    check(await dispatcher.tick() == 1, "Redis 恢复后应投递原任务")
    target = StreamGroup(dispatch.STREAM, "manual-verify", "manual")
    await stream.ensure_group(target)
    entries = await stream.read_group(target, count=10, block_ms=10)
    check(len(entries) == 1, "恢复后队列消息数不正确")
    store = FakeObjectStore()
    pool = WordPool()
    consumer = ReportWorker(
        WorkerOptions(
            database=database, stream=stream, store=store, consumer="manual"
        ),
        pool,
    )
    try:
        check(await consumer.execute(accepted.id), "原任务未执行成功")
        check(not await consumer.execute(accepted.id), "重复执行未被阻止")
    finally:
        pool.close()
    async with database.session() as session:
        row = await renders.get(session, accepted.id)
        if row is None or row.status != "succeeded" or row.object_key is None:
            raise RuntimeError("报告未完成")
        object_key = row.object_key
    payload = await store.get_bytes(object_key)
    check(payload.startswith(b"PK"), "未生成真实 Word 文件")
    return {
        "result": "passed",
        "redis_stopped_and_restarted": True,
        "messages": await raw.xlen(dispatch.STREAM),
        "docx_bytes": len(payload),
        "executions": 1,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("redis_container")
    args = parser.parse_args()
    result = asyncio.run(verify(load_settings(Settings), args.redis_container))
    sys.stdout.write(json.dumps(result) + "\n")


if __name__ == "__main__":
    main()
