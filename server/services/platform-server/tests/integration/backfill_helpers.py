"""回填用例共用的时间轴与跑一次的捷径。

⚠ 时间轴挂在**真实的此刻**上而不是写死的常量：`start_backfill` 自己取 `now`
（它要据此算尾部避让），冻不住。故样本按「几个桶之前」种，断言也按同一把尺子。
"""

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import httpx
from conftest import AppContext

from integration.dataset_helpers import ArchiveWriter, Sample, create_table
from lib.utils.timeutils import utcnow
from platform_server.apps.collect.services import ReadOnlyHistorySource
from platform_server.apps.dataset.crud import table_crud
from platform_server.apps.dataset.schemas import BackfillStartIn
from platform_server.apps.dataset.services import backfill_service
from platform_server.apps.dataset.services.backfill_jobs import (
    BackfillJobs,
    BackfillJobState,
)
from platform_server.apps.dataset.services.backfill_plan import (
    PlanLimits,
    plan_backfill,
)
from platform_server.apps.dataset.services.backfill_run import (
    BackfillContext,
    run_backfill,
)
from platform_server.apps.dataset.services.backfill_service import (
    BackfillRunner,
    initial_state,
)
from platform_server.apps.dataset.services.buckets import (
    bucket_interval,
    bucket_start,
)
from platform_server.apps.dataset.services.collector import Sessions
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog

SHANGHAI = "Asia/Shanghai"
HOUR = timedelta(hours=1)
HOUR_MS = 3_600_000
POINT = "meter_kwh"
BACKFILL_URL = "/api/v1/platform/dataset-tables/{table_id}/backfill"


def backfill_url(table_id: str) -> str:
    """一张台账的回填地址。

    Args: table_id。
    """
    return BACKFILL_URL.format(table_id=table_id)


def current_bucket() -> datetime:
    """此刻所在的那个小时桶（还开着，永远不许回填）。"""
    return bucket_start(
        utcnow(), interval=bucket_interval(HOUR_MS), timezone=SHANGHAI
    )


def bucket_ago(hours: int) -> datetime:
    """当前桶往前数 `hours` 个小时桶。

    Args: hours。
    """
    return current_bucket() - hours * HOUR


async def aggregate_table(
    client: httpx.AsyncClient, **overrides: Any
) -> dict[str, Any]:
    """建一张按小时聚合的台账。

    Args: client, overrides。
    """
    return await create_table(
        client,
        collect_mode="aggregate",
        collect_interval_ms=HOUR_MS,
        **overrides,
    )


@dataclass(frozen=True)
class Backfiller:
    """把「起一次回填并等它收摊」收成一步。

    ⚠ 自己建一个起跑口，不用容器上那个：容器上那个是**只记不跑**的替身
    （端点用例要它，见 `unit/dataset_fakes.RecordingRunner`）。这里三件都换成
    用例这一侧的——会话工厂走用例那条回滚事务、取数走真的归档表、报脏走进程内
    的集合，任务态那一件则与容器共用，好让端点也读得到同一份进度。
    """

    context: AppContext
    archive: ArchiveWriter
    stopped: asyncio.Event = field(default_factory=asyncio.Event)
    #: 单批的预算。调到极小就能验「超时的那一批整个不算数」
    batch_timeout_s: float = 60.0

    async def start(
        self, table_id: str, *, since: datetime, until: datetime
    ) -> dict[str, Any]:
        """起一次回填并等它跑完，回终态。

        Args: table_id, since, until。
        """
        runner = self.runner()
        started = await backfill_service.start_backfill(
            self.context.session,
            runner,
            table_id=uuid.UUID(table_id),
            payload=BackfillStartIn(since=since, until=until),
        )
        assert started.status == "running", started.message
        await runner.drain(timeout_s=60)
        found = await backfill_service.read_progress(
            self.context.session, runner.jobs, table_id=uuid.UUID(table_id)
        )
        assert found is not None
        return found.model_dump()

    async def run_now(
        self, table_id: str, *, since: datetime, until: datetime
    ) -> BackfillJobState:
        """不经起跑口，直接把任务本体跑一遍，回终态。

        ⚠ 用例要在起跑**之前**按下取消标志，而 `start_backfill` 会先清掉它
        （那正是它该做的）——走那条路径就永远测不到批边界上的取消。
        Args: table_id, since, until。
        """
        table = await table_crud.get(self.context.session, uuid.UUID(table_id))
        assert table is not None
        now = utcnow()
        plan = plan_backfill(
            table,
            since=since,
            until=until,
            now=now,
            limits=PlanLimits(
                timezone=SHANGHAI,
                retention_days=None,
                recompute_tail_buckets=2,
            ),
        )
        state = initial_state(table, plan, (since, until), now)
        await run_backfill(self.job_context(), plan, state)
        return state

    def runner(self) -> BackfillRunner:
        """一个真的起跑口，协作者全换成用例这一侧的。"""
        return BackfillRunner(
            sessions=self.sessions,
            history=ReadOnlyHistorySource(database=self.archive.database),
            dirty=DatasetDirtyLog(sink=self.context.dirty),
            jobs=self.jobs,
            settings=self.context.backfill.settings,
        )

    def job_context(self) -> BackfillContext:
        """跑一次回填要的协作者与预算。"""
        return BackfillContext(
            sessions=self.sessions,
            history=ReadOnlyHistorySource(database=self.archive.database),
            dirty=DatasetDirtyLog(sink=self.context.dirty),
            jobs=self.jobs,
            token="test-token",
            batch_timeout_s=self.batch_timeout_s,
            stopped=self.stopped,
        )

    @property
    def jobs(self) -> BackfillJobs:
        """任务态的读写口，与应用同一份。"""
        return self.context.backfill.jobs

    @property
    def sessions(self) -> Sessions:
        """用例那条回滚事务的会话工厂，与 HTTP 那侧共用同一条连接。"""
        return self.context.backfill.sessions


async def seed(
    archive: ArchiveWriter,
    bucket: datetime,
    *values: float,
    minute: int = 5,
) -> None:
    """往一个桶里均匀种几条读数。

    ⚠ 同一个桶种第二批时要换 `minute`：点位历史的主键是
    `(source_id, point_code, ts)`，撞上就是一条 UniqueViolation，
    而它看起来像被测代码写重了。
    Args: archive, bucket, values, minute。
    """
    await archive.write(
        POINT,
        [
            Sample(
                ts=bucket + timedelta(minutes=minute + 10 * index),
                value_num=value,
            )
            for index, value in enumerate(values)
        ],
    )
