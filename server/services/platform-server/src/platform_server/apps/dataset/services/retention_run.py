"""保留期清理的一趟：逐表按 `retention_days` 删过期行，再回收死索引页。

**只删台账行**（`platform.dataset_records`）。点位历史的保留期归
collector-server 管——那是两层里的第 1 层，本模块一个字都不碰（§2）。

⚠ 批的单位是「哪张表、多宽的 `ts` 窗口」，不是「多少行」：PostgreSQL 的 DELETE
没有 LIMIT，行数预算只能在**批边界**上判（约束 a，见 `crud/retention.py`）。
故「这一趟不超过 N 行」做不到，能保证的是「超了就不再发下一条」。

⚠ 每一批各自提交，绝不攒成一个大事务：压缩块的解压额度是**按事务**算的，攒起
来就会在某一批上撞出 `tuple decompression limit exceeded`，而前面删掉的那些一起
回滚——一趟白跑，且下一趟还会在同一处撞上。
"""

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from platform_server.apps.dataset.crud import retention_crud, table_crud
from platform_server.apps.dataset.services.collector import Sessions

_logger = get_logger("platform.dataset.retention")

# 一批删多宽的 ts 窗口。取 7 天 = `dataset_records` 的 chunk_time_interval
# （迁移 f2a91c7d3b48 的 `CHUNK_INTERVAL`），于是一条 DELETE 基本只碰一个 chunk
BATCH_WINDOW = timedelta(days=7)

# 单张表最多切多少个窗口。防御性死闸：正常路径远远用不到，而一个坏掉的下界会
# 让这个 while 一直切下去
MAX_WINDOWS_PER_TABLE = 4096

# 单趟最多 REINDEX 多少个 chunk。单个约 23ms，但锁是排他的，留个闸
MAX_REINDEX_CHUNKS = 32


@dataclass(frozen=True)
class RetentionJob:
    """一张要清理的台账。

    ⚠ `retention_days` 保留成可空而不是在这里就收成 `int`：空的语义是**永久
    保留**，把它当 0 天处理就是把一张台账的全部历史一次删光，而删掉的行找不
    回来。真正拦住它的是 `keep_before` 里那道紧贴 DELETE 的闸。
    """

    table_id: uuid.UUID
    code: str
    retention_days: int | None


@dataclass(frozen=True)
class SweepResult:
    """一张表这一趟的产出。`span` 是实删覆盖到的 ts 跨度，给 REINDEX 圈范围。"""

    rows: int
    span: tuple[datetime, datetime] | None


# 什么都没删的那一趟。跳过永久保留的表、没有过期行的表都是它
NOTHING = SweepResult(rows=0, span=None)


@dataclass
class RetentionStats:
    """一趟清理的账本。进日志，也是用例的观测点。"""

    #: 参与清理的台账数（含出错跳过的）
    tables: int = 0
    #: 实删行数
    rows: int = 0
    #: 出错跳过的表数
    failed: int = 0
    #: 本趟因行数预算触顶提前收工
    is_capped: bool = False
    #: 本趟 REINDEX 过的 chunk 数
    reindexed: int = 0
    #: 真正掉了行的台账编码，报脏用
    swept: list[str] = field(default_factory=list[str])
    #: 本趟 DELETE 覆盖到的 ts 跨度
    span_from: datetime | None = None
    span_to: datetime | None = None

    def absorb(self, job: RetentionJob, result: SweepResult) -> None:
        """把一张表的产出并进这一趟的账。

        Args: job, result。
        """
        self.rows += result.rows
        if result.rows:
            self.swept.append(job.code)
        if result.span is None:
            return
        since, until = result.span
        self.span_from = _earlier(self.span_from, since)
        self.span_to = _later(self.span_to, until)

    def span(self) -> tuple[datetime, datetime] | None:
        """本趟删除覆盖到的完整跨度；一行都没删就给 None。"""
        if self.span_from is None or self.span_to is None:
            return None
        return self.span_from, self.span_to


class Budget:
    """一趟清理的实删行数预算。用完整趟收工，下一趟接着删。

    ⚠ 刻意只在**每批结束后**判定：PG 的 DELETE 不能中途叫停，硬性「不超过 N
    行」做不到。触顶要由调用方响亮记一条——静默截断会让人以为保留期已经完全
    生效了，而其实每趟都只删掉一部分。
    """

    def __init__(self, max_rows: int) -> None:
        """按上限初始化；上限至少 1，0 会让这一趟一条 DELETE 都发不出去。

        Args: max_rows。
        """
        self._max_rows = max(1, max_rows)
        self._used = 0

    @property
    def max_rows(self) -> int:
        """这一趟的行数上限。"""
        return self._max_rows

    @property
    def used(self) -> int:
        """已经删掉多少行。"""
        return self._used

    @property
    def is_exhausted(self) -> bool:
        """预算是否已经用完。"""
        return self._used >= self._max_rows

    def add(self, rows: int) -> None:
        """记一批的实删行数。

        Args: rows。
        """
        self._used += max(0, rows)


async def load_jobs(sessions: Sessions) -> list[RetentionJob]:
    """取出这一趟要清理的台账清单。

    ⚠ 这一步就是约束 a 本身：DELETE 的谓词里只许出现绑定参数，故「删哪几张
    表」必须先 SELECT 进应用层。
    Args: sessions。
    """
    async with sessions.session() as session:
        rows = await table_crud.with_retention(session)
    return [
        RetentionJob(table_id=table_id, code=code, retention_days=days)
        for table_id, code, days in rows
    ]


def keep_before(job: RetentionJob, now: datetime) -> datetime | None:
    """这张表的保留边界：比它更老的行才删。永久保留给 None。

    ⚠ **第二道空值闸，紧贴 DELETE**。第一道在 `table_crud.with_retention` 的
    WHERE 上。两道各自独立，任何一道单独成立都拦得住——`retention_days` 为空
    是「永久保留」，当成 0 天处理就是一次不可逆的清库（§15.1）。
    Args: job, now。
    """
    if job.retention_days is None or job.retention_days <= 0:
        return None
    return now - timedelta(days=job.retention_days)


async def sweep_table(
    sessions: Sessions, job: RetentionJob, *, now: datetime, budget: Budget
) -> SweepResult:
    """删掉一张台账的过期行，按 `BATCH_WINDOW` 分批。

    Args: sessions, job, now, budget。
    """
    cutoff = keep_before(job, now)
    if cutoff is None:
        return NOTHING
    async with sessions.session() as session:
        floor = await retention_crud.oldest_ts(session, job.table_id)
        if floor is None or floor >= cutoff:
            return NOTHING
        result = await _delete_windows(session, job, floor, cutoff, budget)
    if result.rows:
        _logger.info(
            "dataset_retention_table_swept",
            "这张台账的过期行已删掉",
            table_code=job.code,
            retention_days=job.retention_days,
            rows=result.rows,
            cutoff=cutoff.isoformat(),
        )
    return result


async def reindex_span(
    sessions: Sessions, *, span: tuple[datetime, datetime]
) -> int:
    """对本趟删过的那段 chunk 跑 REINDEX，返回处理成功的 chunk 数。

    ⚠ 整段吞异常：清理本身已经成功了，不该因为「索引没回收成」判故障。
    Args: sessions, span。
    """
    since, until = span
    try:
        async with sessions.session() as session:
            names = await retention_crud.chunks_in_span(
                session, since=since, until=until
            )
            return await _reindex_each(session, names)
    except Exception as error:
        _logger.warning(
            "dataset_retention_reindex_failed",
            "回收索引这一步出错，本趟清理的结果不受影响",
            error_type=type(error).__name__,
        )
        return 0


async def _delete_windows(
    session: AsyncSession,
    job: RetentionJob,
    floor: datetime,
    cutoff: datetime,
    budget: Budget,
) -> SweepResult:
    """逐个 ts 窗口把 `[floor, cutoff)` 删完，一批一提交。

    Args: session, job, floor（表里最老一行）, cutoff（保留边界）, budget。
    """
    total = 0
    windows = 0
    start = floor
    touched = floor
    while start < cutoff and windows < MAX_WINDOWS_PER_TABLE:
        stop = min(start + BATCH_WINDOW, cutoff)
        rows = await retention_crud.delete_window(
            session, table_id=job.table_id, from_ts=start, to_ts=stop
        )
        await session.commit()
        total += rows
        budget.add(rows)
        windows += 1
        touched = stop
        start = stop
        # ⚠ 批间让出事件循环：同一个进程上还挂着另外六条循环，一趟上百批会把
        # 它们连同健康检查一起卡住
        await asyncio.sleep(0)
        if budget.is_exhausted:
            break
    return SweepResult(rows=total, span=(floor, touched) if total else None)


async def _reindex_each(session: AsyncSession, names: list[str]) -> int:
    """逐个 chunk 回收索引，单个失败不中断其余的。

    Args: session, names。
    """
    done = 0
    for name in names[:MAX_REINDEX_CHUNKS]:
        if not retention_crud.CHUNK_NAME.match(name):
            _logger.warning(
                "dataset_retention_chunk_rejected",
                "chunk 名的形状不对，跳过它的 REINDEX",
                chunk=name,
            )
            continue
        if await _reindex_one(session, name):
            done += 1
        await asyncio.sleep(0)
    return done


async def _reindex_one(session: AsyncSession, name: str) -> bool:
    """回收一个 chunk 的索引；拿不到排他锁就跳过。

    ⚠ 超时必须**吞掉**而不是往上抛：`REINDEX TABLE` 拿的是 ACCESS EXCLUSIVE
    锁，为了回收索引把写入堵死，是拿要紧的事换不要紧的事。
    ⚠ 失败要 rollback：语句报错之后这条事务已经作废，不回滚的话后面每一个
    chunk 都会跟着报「事务已中止」，看起来像整片 chunk 都锁着。
    Args: session, name。
    """
    try:
        await retention_crud.reindex_chunk(session, name)
        await session.commit()
    except Exception as error:
        await session.rollback()
        _logger.warning(
            "dataset_retention_reindex_skipped",
            "这个 chunk 没拿到排他锁，跳过它的 REINDEX",
            chunk=name,
            error_type=type(error).__name__,
        )
        return False
    return True


def _earlier(current: datetime | None, given: datetime) -> datetime:
    """两个时刻里靠前的那个；还没有就取给的那个。

    Args: current, given。
    """
    return given if current is None else min(current, given)


def _later(current: datetime | None, given: datetime) -> datetime:
    """两个时刻里靠后的那个；还没有就取给的那个。

    Args: current, given。
    """
    return given if current is None else max(current, given)
