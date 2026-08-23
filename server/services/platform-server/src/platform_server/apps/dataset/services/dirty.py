"""台账脏信号：把「这张表刚被写过」告诉大屏发布器，免得它定频空转。

写入侧往一个 Redis 集合里塞表编码，发布器按需原子取走（docs/DATASET_DESIGN.md
§16）。集合而不是列表：一次提交改十行只该让下游取一次数。
"""

from dataclasses import dataclass
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import after_commit
from lib.logging import get_logger

_logger = get_logger("platform.dataset.dirty")

# 跨进程契约：台账写入侧写、大屏发布器读，两边必须是同一个 Redis 库。
# ⚠ 写死不可配——让它可配等于让两份配置各认一个键，而现象只是「大屏不更新」
DIRTY_TABLES_KEY = "platform:dataset:dirty"


class SetSink(Protocol):
    """把成员塞进一个集合的最小面。真实现是 `lib.cache.Cache`。"""

    async def add_to_set(self, key: str, *members: str) -> None:
        """把成员加进集合。

        Args: key, members。
        """
        ...


@dataclass(frozen=True)
class DatasetDirtyLog:
    """脏表登记口。"""

    sink: SetSink
    key: str = DIRTY_TABLES_KEY

    async def mark(self, table_code: str) -> None:
        """把一张台账报为脏。

        ⚠ 只许在事务**提交之后**调（`deps.after_commit`）：提交前报脏，
        发布器抢先读到的是旧数据，然后把它当新值推出去。
        ⚠ 报脏失败只记日志不抛：数据已经落库了，大屏最多晚一个兜底周期看到，
        而抛出去就是把一次成功的写入变成 500。
        Args: table_code。
        """
        try:
            await self.sink.add_to_set(self.key, table_code)
        except Exception as error:
            _logger.warning(
                "dataset_dirty_mark_failed",
                "台账报脏未发出，大屏将由兜底轮次补上",
                table_code=table_code,
                error_type=type(error).__name__,
            )


def mark_dirty(
    session: AsyncSession, dirty: DatasetDirtyLog, table_code: str
) -> None:
    """登记「这次提交成功之后把这张台账报为脏」。

    ⚠ 每一条**会改变这张表读出值**的写入路径都要调：录入、编辑、删除、写与撤
    人工修正、重算。漏调的表现是大屏数值静默不更新，没有任何告警。
    ⚠ 走提交后钩子而不是就地报：就地报等于在事务还没落地时告诉发布器「有新
    数据了」，它抢先读到的是旧值，然后把旧值当新值推出去。
    Args: session, dirty, table_code。
    """
    after_commit(session, lambda: dirty.mark(table_code))
