"""台账面那几跳跨进程依赖的假件：报脏口、归档库只读面与回填的起跑口。"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC
from typing import Any

from lib.errors import DependencyUnavailable
from lib.testing import InMemoryCache
from platform_server.apps.dataset.services import BackfillJobs, BackfillRunner
from platform_server.apps.dataset.services.backfill_jobs import (
    BackfillJobState,
)
from platform_server.apps.dataset.services.backfill_plan import BackfillPlan
from platform_server.apps.dataset.services.collector import Sessions
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog
from platform_server.container import DatasetParts
from platform_server.lease import Lease
from platform_server.settings import Settings

# 减数查询的判别标志。⚠ 认这一段而不是整条 SQL：改了措辞用例仍该照常分流，
# 而两条查询答错对方那一份的表现是「delta 全空」或「所有桶都是同一个数」
PREVIOUS_END_MARKER = "DISTINCT ON"


@dataclass
class FakeSetSink:
    """进程内的集合登记，替掉 Redis。

    ⚠ 与真实现同样按集合去重：一次提交改十行只该留下一个成员，用例断言的正是
    这一点。
    """

    sets: dict[str, set[str]] = field(default_factory=dict[str, set[str]])

    async def add_to_set(self, key: str, *members: str) -> None:
        """把成员加进集合。

        Args: key, members。
        """
        self.sets.setdefault(key, set()).update(members)

    def members(self, key: str) -> set[str]:
        """看一眼某个集合里现在有什么。

        Args: key。
        """
        return set(self.sets.get(key, set()))


@dataclass
class FakeHistory:
    """归档库的只读面替身：分桶查询与减数查询各答一份预置结果。

    ⚠ 不解析 SQL：断言的是被测代码**生成**的文本与绑定参数，那才是会写错的
    地方。真跑一遍要 TimescaleDB，那一层由集成用例对着真库验。
    """

    buckets: list[dict[str, object]] = field(
        default_factory=list[dict[str, object]]
    )
    previous: list[dict[str, object]] = field(
        default_factory=list[dict[str, object]]
    )
    queries: list[tuple[str, dict[str, object]]] = field(
        default_factory=list[tuple[str, dict[str, object]]]
    )

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]:
        """按查询种类作答。

        Args: sql, params。
        """
        self.queries.append((sql, dict(params)))
        if PREVIOUS_END_MARKER in sql:
            return list(self.previous)
        return list(self.buckets)

    def sql_of(self, marker: str) -> str:
        """跑过的查询里第一条含这一段的 SQL。

        Args: marker。
        """
        return next(sql for sql, _ in self.queries if marker in sql)

    def params_of(self, marker: str) -> dict[str, object]:
        """跑过的查询里第一条含这一段的绑定参数。

        Args: marker。
        """
        return next(params for sql, params in self.queries if marker in sql)


@dataclass
class RecordingRunner(BackfillRunner):
    """起跑口的替身：只记下起过什么，不真的开后台任务。

    ⚠ 端点用例必须用它：用例那条会话是一条**回滚事务上的单连接**，而后台任务
    会在同一条连接上另开一个短事务——两者一交错就是 `PendingRollbackError`，
    而报错的位置离真正的原因很远。
    ⚠ 只替掉 `launch` 这一件：`stop` / `drain` 与真实现共用一份，免得替身比
    真实现宽（真实现的 `launch` 由 `test_dataset_backfill_runner.py` 钉住，
    真的跑一遍回填由 `tests/integration/test_dataset_backfill.py` 对着真库验）。
    """

    launched: list[tuple[BackfillPlan, BackfillJobState]] = field(
        default_factory=list[tuple[BackfillPlan, BackfillJobState]]
    )

    def launch(
        self,
        plan: BackfillPlan,
        state: BackfillJobState,
        *,
        token: str,
        batch_timeout_s: float,
    ) -> None:
        """记一笔就算起过了。

        Args: plan, state, token, batch_timeout_s。
        """
        del token, batch_timeout_s
        self.launched.append((plan, state))


def recording_runner(sessions: Sessions, settings: Settings) -> RecordingRunner:
    """一个只记不跑的起跑口，协作者全是进程内假件。

    Args: sessions, settings。
    """
    return RecordingRunner(
        sessions=sessions,
        history=FakeHistory(),
        dirty=DatasetDirtyLog(sink=FakeSetSink()),
        jobs=BackfillJobs(store=InMemoryCache()),
        settings=settings,
    )


@dataclass
class HalfBrokenStore:
    """能抢锁、写不了任务态的 Redis 替身。

    ⚠ 专验一件事：起任务时任务态落不下去，抢下的那把锁要放掉——留着它等于让
    这张表的下一次回填白等一个 TTL，而界面上只会说「已经有一个回填在跑」。
    """

    cache: InMemoryCache = field(default_factory=InMemoryCache)

    async def get(self, key: str) -> str | None:
        return await self.cache.get(key)

    async def set_json(self, key: str, value: Any, *, ttl_s: int) -> None:
        del key, value, ttl_s
        raise DependencyUnavailable("缓存服务暂时不可用")

    async def set_if_absent(self, key: str, value: str, *, ttl_s: int) -> bool:
        return await self.cache.set_if_absent(key, value, ttl_s=ttl_s)

    async def renew_if_owner(self, key: str, value: str, *, ttl_s: int) -> bool:
        return await self.cache.renew_if_owner(key, value, ttl_s=ttl_s)

    async def delete_if_owner(self, key: str, value: str) -> bool:
        return await self.cache.delete_if_owner(key, value)

    async def delete(self, key: str) -> None:
        await self.cache.delete(key)

    async def exists(self, key: str) -> bool:
        return await self.cache.exists(key)


def dataset_parts(
    sessions: Sessions, settings: Settings, lease: Lease
) -> DatasetParts:
    """台账那一面的四件，全是进程内假件。

    ⚠ 收成一个工厂而不是在每处装配点各拼一遍：那四件每加一期就多一件，
    而拼错一件的表现是那一面的用例整片红在一句「缺少参数」上。
    Args: sessions, settings, lease。
    """
    return DatasetParts(
        dirty=DatasetDirtyLog(sink=FakeSetSink()),
        backfill=recording_runner(sessions, settings),
        lease=lease,
        timezone=UTC,
    )
