"""整装应用的假容器：把会打网络的长生命周期对象换成进程内假件。

从 `conftest.py` 拆出来：那份夹具文件贴着 600 行的上限。
"""

from dataclasses import dataclass, replace

from lib.idempotency import IdempotencyStore
from lib.testing import InMemoryCache
from platform_server.apps.collect.services import CommandBus, PlanNotifier
from platform_server.apps.dashboard.services import StaticPointCatalog
from platform_server.apps.dataset.services import (
    BackfillJobs,
    DatasetDirtyLog,
)
from platform_server.container import IDEMPOTENCY_NAMESPACE, Container
from unit.collect_fakes import (
    FakeChannelPublisher,
    FakeCommandTransport,
    FakeHistorySource,
)
from unit.database_fakes import MakerSessions
from unit.dataset_fakes import (
    FakeSetSink,
    RecordingRecomputeRunner,
    RecordingRunner,
    recompute_jobs,
)
from unit.opcua_fakes import FakeNodeWriter
from unit.source_fakes import FakeAcSource

# 命令总线的两档预算，固定住，断言里的信封才是可手写的常量
BROWSE_TIMEOUT_S = 10.0
COMMAND_TIMEOUT_S = 5.0
SUBTREE_TIMEOUT_S = 15.0
PLAN_CHANNEL = "collect:plan:changed"


@dataclass(frozen=True)
class CollectFakes:
    """采集面那三跳跨进程调用的假件，一次性交给用例。"""

    bus: FakeCommandTransport
    plans: FakeChannelPublisher
    history: FakeHistorySource


@dataclass(frozen=True)
class ExternalFakes:
    """整装应用要替掉的全部跨进程依赖，打成一包。

    ⚠ 打成一包不是为了好看：fixture 的形参上限与函数一样是 5，而
    `app_context` 还要 settings / 可达性 / 签名器三件。
    """

    ac_source: FakeAcSource
    points: StaticPointCatalog
    collect: CollectFakes
    nodes: FakeNodeWriter
    dirty: FakeSetSink


def faked_container(
    built: Container, fakes: ExternalFakes, sessions: MakerSessions
) -> Container:
    """把会打网络的长生命周期对象换成进程内假件。

    ⚠ 用例不许打网络，而 Redis 与归档库在 CI 里也不存在。
    ⚠ 回填的起跑口换成**只记不跑**的替身：用例那条会话是一条回滚事务上的
    单连接，后台任务会在同一条连接上另开短事务，一交错就是
    `PendingRollbackError`。真跑一遍回填由 `integration` 那一批用例自建起跑口
    验（`backfill_helpers.Backfiller`）。
    Args: built, fakes, sessions。
    """
    dirty = DatasetDirtyLog(sink=fakes.dirty)
    # ⚠ 回填与重算共用一个存储：两者抢的是同一把按表的锁
    jobs_store = InMemoryCache()
    return replace(
        built,
        dataset=replace(
            built.dataset,
            dirty=dirty,
            backfill=RecordingRunner(
                sessions=sessions,
                history=fakes.collect.history,
                dirty=dirty,
                jobs=BackfillJobs(store=jobs_store),
                settings=built.settings,
            ),
            recompute=RecordingRecomputeRunner(
                sessions=sessions,
                dirty=dirty,
                jobs=recompute_jobs(jobs_store),
                timezone=built.dataset.timezone,
                instance=built.settings.app_instance,
            ),
        ),
        nodes=fakes.nodes,
        idempotency=IdempotencyStore(
            cache=InMemoryCache(), namespace=IDEMPOTENCY_NAMESPACE
        ),
        command_bus=CommandBus(
            transport=fakes.collect.bus,
            browse_timeout_s=BROWSE_TIMEOUT_S,
            command_timeout_s=COMMAND_TIMEOUT_S,
            subtree_timeout_s=SUBTREE_TIMEOUT_S,
        ),
        plan_notifier=PlanNotifier(
            publisher=fakes.collect.plans, channel=PLAN_CHANNEL
        ),
        history=fakes.collect.history,
    )


def recording_recompute(container: Container) -> RecordingRecomputeRunner:
    """取出装配进去的重算替身。

    Args: container。
    """
    runner = container.dataset.recompute
    assert isinstance(runner, RecordingRecomputeRunner)
    return runner
