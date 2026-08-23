"""回填任务态：Redis 上那份进度、那把单飞锁，与那个取消标志。

**三个键各管各的，谁也替不了谁**（docs/DATASET_DESIGN.md §14.6）：

- `…:{table_id}` 任务态，活一天：跑完还要留着给人看这一次补了多少；
- `…:{table_id}:lock` 单飞锁，每批续期：拿任务态当锁的话，「上一次跑完的
  记录」会把下一次回填永久挡在门外；
- `…:{table_id}:cancel` 取消标志，与锁同寿：受理取消的副本未必是正在跑那个
  任务的副本，进程内的标志传不过去。
"""

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Literal, Protocol, cast

from lib.logging import get_logger
from lib.utils.timeutils import format_rfc3339
from platform_server.apps.dataset.errors import DatasetBackfillUnreadable

_logger = get_logger("platform.dataset.backfill")

# 跨进程契约：起任务的副本、受理取消的副本与查进度的副本认的是同一批键。
# ⚠ 写死不可配——让它可配等于让两份配置各认一批键，而现象只是「取消没反应」
KEY_PREFIX = "platform:dataset:backfill:"
# 任务态留多久（秒）。它是**进度**不是账本：真正的结果在台账行里
STATE_TTL_S = 86_400
# 锁与取消标志的存活期（秒），每批续一次。进程被 kill 之后最多这么久自动解锁
LOCK_TTL_S = 300

# 四个终局状态。⚠ 「取消」与「失败」分开：前者是人按的，后者要有人去看日志
BackfillStatus = Literal["cancelled", "done", "failed", "running"]

STATUS_RUNNING: BackfillStatus = "running"
STATUS_DONE: BackfillStatus = "done"
STATUS_CANCELLED: BackfillStatus = "cancelled"
STATUS_FAILED: BackfillStatus = "failed"

# 出错原文进任务态时的截断长度：够看清是哪一类错，又不至于把一整段 traceback
# 塞进 Redis
_ERROR_LIMIT = 512


class JobStore(Protocol):
    """任务态要用的那几个 Redis 动作。真实现是 `lib.cache.Cache`。

    ⚠ 本模块自己声明这个面而不认整个 `CacheLike`：用到的是其中五个方法，
    窄面让用例能拿一个五方法的假件顶上。
    """

    async def get(self, key: str) -> str | None: ...

    async def set_json(self, key: str, value: Any, *, ttl_s: int) -> None: ...

    async def set_if_absent(
        self, key: str, value: str, *, ttl_s: int
    ) -> bool: ...

    async def renew_if_owner(
        self, key: str, value: str, *, ttl_s: int
    ) -> bool: ...

    async def delete_if_owner(self, key: str, value: str) -> bool: ...

    async def delete(self, key: str) -> None: ...

    async def exists(self, key: str) -> bool: ...


@dataclass
class BackfillJobState:
    """一次回填对外可见的全部状态。

    ⚠ 请求区间与实际区间两份都留着：只给实际区间的话，被 clamp 掉的那一段
    在界面上无从对比，用户看到的只是「它补的比我要的少」。
    """

    table_id: str
    table_code: str
    status: BackfillStatus
    interval_ms: int
    #: 实际回填的区间，两端都是**桶起点**、闭区间
    since: datetime
    until: datetime
    requested_since: datetime
    requested_until: datetime
    is_clamped: bool
    #: 取数路径。本仓恒为 `raw`，理由见 `backfill_plan.RAW_PATH`
    fast_path: str
    total_buckets: int
    started_at: datetime
    updated_at: datetime
    done_buckets: int = 0
    written_rows: int = 0
    recomputed: int = 0
    recompute_failed: int = 0
    is_recompute_truncated: bool = False
    #: 已经补到哪个桶（最后一批的末桶）
    cursor: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    message: str = ""
    #: clamp、取数路径、重算触顶这些「用户必须知道」的说明，逐条中文
    notes: list[str] = field(default_factory=list[str])

    def to_payload(self) -> dict[str, Any]:
        """摊成能进 Redis 的 JSON。时刻一律 RFC3339 UTC。"""
        payload = asdict(self)
        return {
            key: format_rfc3339(value) if isinstance(value, datetime) else value
            for key, value in payload.items()
        }

    def fail(self, error: str, message: str) -> None:
        """落成失败态。

        Args: error, message。
        """
        self.status = STATUS_FAILED
        self.error = error[:_ERROR_LIMIT]
        self.message = message


@dataclass(frozen=True)
class BackfillJobs:
    """任务态、单飞锁与取消标志的读写口。"""

    store: JobStore
    state_ttl_s: int = STATE_TTL_S
    lock_ttl_s: int = LOCK_TTL_S

    async def read(self, table_id: uuid.UUID) -> dict[str, Any] | None:
        """读任务态；没有任务（或已过期）给 None。

        ⚠ 存着的内容读不出来时**抛**而不是当作没有任务：「我说不出来」与
        「什么都没有」是两个答案，混成一个会让用户在读不到的时候又发一次回填，
        而那一次撞上的是仍然握着锁的上一次。Redis 不可达同理，由缓存层抛。
        Args: table_id。
        """
        raw = await self.store.get(_state_key(table_id))
        if raw is None:
            return None
        try:
            found: object = json.loads(raw)
        except json.JSONDecodeError as error:
            raise DatasetBackfillUnreadable(
                "回填进度暂时读不出来，请稍后再看"
            ) from error
        if not isinstance(found, dict):
            raise DatasetBackfillUnreadable("回填进度暂时读不出来，请稍后再看")
        # 边界收窄：JSON 对象的键在 Python 里一定是 `str`，而 `json.loads`
        # 的返回类型宽到 `Any`，narrow 之后仍是部分未知
        return cast("dict[str, Any]", found)

    async def write(
        self, state: BackfillJobState, *, at: datetime, is_quiet: bool = False
    ) -> None:
        """把任务态写回去。

        ⚠ `is_quiet` 是给**进度心跳**用的：写不进去只该少一次刷新，不该把一次
        已经落库的回填变成失败。终态那次也用它——数据早写完了，为了写不进一条
        进度而把 finally 里的收尾链条打断，等于连锁都放不掉。
        Args: state, at, is_quiet。
        """
        state.updated_at = at
        try:
            await self.store.set_json(
                _state_key(uuid.UUID(state.table_id)),
                state.to_payload(),
                ttl_s=self.state_ttl_s,
            )
        except Exception as error:
            if not is_quiet:
                raise
            _logger.warning(
                "dataset_backfill_state_write_failed",
                "回填进度没写进去，这一次刷新丢了",
                table_code=state.table_code,
                error_type=type(error).__name__,
            )

    async def claim(self, table_id: uuid.UUID, token: str) -> bool:
        """抢这张表的单飞锁。抢到返回 True。

        ⚠ 走 `SET NX` 这一次原子写，不是「先查再插」：两个请求同时打进来时，
        先查再插会双双看见「没人占」，于是两个回填同时改写同一段历史。
        Args: table_id, token。
        """
        return await self.store.set_if_absent(
            _lock_key(table_id), token, ttl_s=self.lock_ttl_s
        )

    async def renew(self, table_id: uuid.UUID, token: str) -> bool:
        """续锁，每批一次。续不上说明锁已经不是自己的了。

        Args: table_id, token。
        """
        return await self.store.renew_if_owner(
            _lock_key(table_id), token, ttl_s=self.lock_ttl_s
        )

    async def release(self, table_id: uuid.UUID, token: str) -> None:
        """收尾：放锁 + 清取消标志。

        ⚠ 放锁必须是 CAS：自己那把锁可能早已过期并被下一个回填抢走（收尾重算
        跑得比 TTL 还久就会这样），无条件删就是把接任者的锁一起删掉，而它正
        以为自己独占着。取消标志同理——只有确实是自己那一把时才清。
        ⚠ 任务态**不清**：它要留着给人看这一次补了多少、被裁了哪一段，
        靠 TTL 自己过期。
        Args: table_id, token。
        """
        if await self.store.delete_if_owner(_lock_key(table_id), token):
            await self.store.delete(_cancel_key(table_id))

    async def request_cancel(self, table_id: uuid.UUID) -> None:
        """按下取消。worker 在下一个批边界读到它就停。

        ⚠ 刻意不用 `task.cancel()`：受理这次取消的进程未必是正在跑那个任务的
        进程，而进程内的取消传不过去。协作式的代价是「等当前这批跑完」，换来的
        是绝不留下写了一半的批。
        Args: table_id。
        """
        await self.store.set_json(
            _cancel_key(table_id), True, ttl_s=self.lock_ttl_s
        )

    async def clear_cancel(self, table_id: uuid.UUID) -> None:
        """清掉取消标志。

        ⚠ 抢到锁之后立刻清一次：上一次任务留下的标志会把这一次刚起的回填在第一
        个批边界直接毙掉，而回执里只说「已取消」，看不出取消的是上一次。
        Args: table_id。
        """
        await self.store.delete(_cancel_key(table_id))

    async def is_cancelled(self, table_id: uuid.UUID) -> bool:
        """有没有人按过取消。

        ⚠ 读不到标志按「没取消」处理：宁可多补一批幂等的行，也不要因为 Redis
        抖一下就把一次跑到一半的回填停在半路。
        Args: table_id。
        """
        try:
            return await self.store.exists(_cancel_key(table_id))
        except Exception as error:
            _logger.warning(
                "dataset_backfill_cancel_flag_unreadable",
                "取消标志读不到，本批按未取消继续",
                table_id=str(table_id),
                error_type=type(error).__name__,
            )
            return False


def _state_key(table_id: uuid.UUID) -> str:
    """任务态的键。

    Args: table_id。
    """
    return f"{KEY_PREFIX}{table_id}"


def _lock_key(table_id: uuid.UUID) -> str:
    """单飞锁的键。

    Args: table_id。
    """
    return f"{KEY_PREFIX}{table_id}:lock"


def _cancel_key(table_id: uuid.UUID) -> str:
    """取消标志的键。

    Args: table_id。
    """
    return f"{KEY_PREFIX}{table_id}:cancel"
