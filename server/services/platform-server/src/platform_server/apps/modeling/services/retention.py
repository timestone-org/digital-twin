"""建模的两层清理：节点明细按次数收敛，运行记录按天数过期。

两层分开是因为成本差着量级：一次运行的中间结果是 MB 级，运行行是几百字节。
删了明细的老运行**仍然在历史列表里看得见**，只是点不开中间结果。
⚠ 二进制产物跟着运行明细一起清，且**先删库行、再删对象**：反过来的话，一次
数据库回滚会留下一批指着不存在的键的行，而那要到有人点开时才发现。
⚠ 已发布过模型版本的运行**既不删、也不占保留名额**——让它们参与计数会把还想
留着的那 20 次实验提前挤出去（docs/MODELING_DESIGN.md §6.5）。
"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from lib.logging import get_logger
from lib.objectstore import ObjectStore, ObjectStoreError
from platform_server.apps.modeling.crud import (
    model_version_crud,
    node_run_crud,
    run_crud,
)
from platform_server.apps.modeling.services.artifact_store import run_prefix
from platform_server.apps.modeling.services.run_dispatch import (
    INTERRUPTED_REASON,
)
from platform_server.apps.modeling.services.sessions import Sessions

_logger = get_logger("platform.modeling.retention")

# 一趟最多收多少条，防一次扫死一张表
SWEEP_MAX_RUNS = 2000


@dataclass(frozen=True)
class RetentionOptions:
    """清理的节奏与保留量。"""

    keep_per_pipeline: int
    retention_days: int
    stale_minutes: int
    interval_s: float


async def converge_pipeline(
    sessions: Sessions,
    *,
    pipeline_id: uuid.UUID,
    keep: int,
    store: ObjectStore | None = None,
) -> int:
    """把一条流水线的节点级明细收敛到最近 `keep` 次运行，回删了几条。

    ⚠ 每次运行结束时调一次就够，不必另起定时任务：删的永远是「这条流水线的
    老运行」，范围有界。
    Args: sessions, pipeline_id, keep, store。
    """
    async with sessions.session() as session:
        published = await model_version_crud.published_run_ids(
            session, pipeline_id
        )
        stale = await run_crud.ids_beyond_keep(
            session, pipeline_id=pipeline_id, keep=keep, exclude=published
        )
        removed = 0
        for run_id in stale:
            removed += await node_run_crud.delete_by_run(session, run_id)
    await _drop_artifacts(store, stale)
    return removed


async def sweep_expired(
    sessions: Sessions, *, options: RetentionOptions, store: ObjectStore | None
) -> int:
    """删掉过期的运行行，回删了几条。

    Args: sessions, options, store。
    """
    before = datetime.now(UTC) - timedelta(days=options.retention_days)
    async with sessions.session() as session:
        published = await model_version_crud.published_run_ids(session, None)
        expired = await run_crud.expired_ids(
            session, before=before, exclude=published, limit=SWEEP_MAX_RUNS
        )
        removed = await run_crud.delete_by_ids(session, expired)
    await _drop_artifacts(store, expired)
    return removed


async def _drop_artifacts(
    store: ObjectStore | None, run_ids: list[uuid.UUID]
) -> None:
    """把这些运行的二进制产物整片删掉。

    ⚠ 删不掉只记一条日志、不让整趟清理失败：库行已经没了，留下的字节是垃圾而
    不是错误；为它把清理循环停掉的代价大得多。
    ⚠ 已发布的运行不会走到这里——它们被 `published` 排除在外，而它们的产物
    发布时已经搬到版本自己的键下了。
    Args: store, run_ids。
    """
    if store is None:
        return
    for run_id in run_ids:
        try:
            await store.delete_prefix(run_prefix(str(run_id)))
        except ObjectStoreError as error:
            _logger.warning(
                "modeling_artifact_sweep_failed",
                "运行产物没删掉",
                run_id=str(run_id),
                error=error,
            )


async def reap_stale(sessions: Sessions, *, options: RetentionOptions) -> int:
    """把心跳陈旧、状态却还在途的运行落成终态，回处理了几条。

    ⚠ 不落终态的话，那条部分唯一索引会把这条流水线**永久**锁在「已有运行在途」
    上——用户再也发不起第二次，而界面上那次运行看起来一直在跑。
    Args: sessions, options。
    """
    before = datetime.now(UTC) - timedelta(minutes=options.stale_minutes)
    async with sessions.session() as session:
        stale = await run_crud.stale_ids(
            session, before=before, limit=SWEEP_MAX_RUNS
        )
        for run_id in stale:
            run = await run_crud.get(session, run_id)
            if run is None:
                continue
            run.status = "failed"
            run.finished_at = datetime.now(UTC)
            run.error_text = INTERRUPTED_REASON
        return len(stale)


class ModelingRetention:
    """夜间清理循环。与其它消费循环并列跑在 worker 里。"""

    def __init__(
        self,
        *,
        sessions: Sessions,
        options: RetentionOptions,
        store: ObjectStore | None = None,
    ) -> None:
        self._database = sessions
        self._options = options
        self._store = store
        self._is_stopping = False
        self._idle = asyncio.Event()
        self._idle.set()

    def stop(self) -> None:
        """不再开始新一趟。手上这趟仍然走完。"""
        self._is_stopping = True

    async def drain(self, timeout_s: float) -> None:
        """等手上那趟走完。

        Args: timeout_s。
        """
        try:
            async with asyncio.timeout(timeout_s):
                await self._idle.wait()
        except TimeoutError:
            _logger.warning(
                "modeling_retention_drain_timeout", "清理未能在宽限期内走完"
            )

    async def run(self) -> None:
        """常驻循环。⚠ 偶发错误记录后继续，否则一次抖动会让清理永久停止。"""
        while not self._is_stopping:
            await self._sweep()
            await asyncio.sleep(self._options.interval_s)

    async def _sweep(self) -> None:
        self._idle.clear()
        try:
            reaped = await reap_stale(self._database, options=self._options)
            expired = await sweep_expired(
                self._database, options=self._options, store=self._store
            )
            _logger.info(
                "modeling_retention_swept",
                "建模保留期清理走完一趟",
                reaped=reaped,
                expired=expired,
            )
        except Exception as error:
            _logger.error(
                "modeling_retention_failed", "清理这一趟失败", error=error
            )
        finally:
            self._idle.set()
