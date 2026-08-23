"""worker 角色的装配与关停顺序。

⚠ 关停顺序不是启动顺序的逆序：先停收新活、再 drain、最后才关连接池。反过来
会让在途那一片拿着一个已经关掉的连接池（docs/agents/runtime-resilience.md §8）。
"""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import cast

import pytest

from platform_server import __main__ as main_module
from platform_server import worker
from platform_server.apps.hvac.services.ac_model_worker import (
    TrainerPool,
    TrainingConsumer,
)
from platform_server.apps.hvac.services.ac_startup_worker import (
    ShardConsumer,
)
from platform_server.container import Container
from platform_server.settings import ROLE_API, ROLE_WORKER, Settings
from platform_server.worker import (
    Consumer,
    LeaseHolder,
    WorkerRuntime,
    build_consumer,
    build_trainer,
    run_until_stopped,
    selfcheck,
)
from unit.wiring_fakes import build_container as build_wiring_container
from unit.wiring_fakes import build_settings as build_wiring_settings

PLACEHOLDER = "worker-test"


@dataclass
class FakeConsumer:
    """记下停与 drain 的先后，其余什么都不做。"""

    ledger: list[str]
    drained: list[float] = field(default_factory=list[float])

    async def run(self) -> None:
        return None

    def stop(self) -> None:
        self.ledger.append("stop")

    async def drain(self, timeout_s: float) -> None:
        self.ledger.append("drain")
        self.drained.append(timeout_s)


@dataclass
class FakeLeaseholder:
    """记下让位的时机。"""

    ledger: list[str]

    async def release(self) -> None:
        self.ledger.append("released")


def build_settings() -> Settings:
    """一份能构造出来的 worker 配置，不连任何依赖。"""
    return build_wiring_settings(role=ROLE_WORKER)


def build_container(ledger: list[str]) -> Container:
    """一个装着假依赖的组合根。

    Args: ledger。
    """
    return build_wiring_container(ledger, settings=build_settings())


def test_the_consumer_takes_its_identity_from_config() -> None:
    """流名、消费组与消费者名都由配置决定，多副本各认各的。"""
    consumer = build_consumer(build_container([]))
    options = consumer._options
    assert options.target.stream == "platform:ac-startup:shards"
    assert options.target.group == "ac-startup-workers"
    assert options.target.consumer == "worker-1"
    assert options.prefetch == 8
    assert options.shard_timeout_s == 300.0


def test_the_trainer_takes_its_identity_from_config() -> None:
    """训练消费循环的流名、消费组与时区都由配置决定。"""
    pool = TrainerPool(lambda: ThreadPoolExecutor(max_workers=1))
    try:
        trainer = build_trainer(build_container([]), pool=pool)
    finally:
        pool.shutdown()
    options = trainer._options
    assert options.target.stream == "platform:ac-model:train"
    assert options.target.group == "ac-model-trainers"
    assert options.target.consumer == "worker-1"
    assert options.timezone == "Asia/Shanghai"
    assert options.train_timeout_s == 900.0


def test_the_shard_budget_exceeds_the_sum_of_its_source_queries() -> None:
    """⚠ 一片的预算必须大于它内部全部外库查询之和，否则总是先被外层掐断。"""
    settings = build_settings()
    six_units = settings.sqlserver_query_timeout_s * 6
    assert settings.acstartup_shard_timeout_s > six_units


async def test_the_selfcheck_only_logs_and_never_blocks_startup() -> None:
    """依赖不可达不阻断 worker 启动，它只是没活干。"""
    ledger: list[str] = []
    container = build_container(ledger)
    await selfcheck(container)
    assert ledger == []


async def test_shutdown_stops_intake_then_drains_then_releases() -> None:
    """⚠ 顺序是停 → drain → 让资源，且连接池最后关。"""
    ledger: list[str] = []
    container = build_container(ledger)
    consumer = FakeConsumer(ledger)
    await run_until_stopped(
        WorkerRuntime(
            consumers=(cast(Consumer, consumer),),
            leaseholders=(),
            container=container,
            wait=_immediate,
        ),
        drain_timeout_s=1.5,
    )
    assert ledger == [
        "stop",
        "drain",
        "stream",
        # ⚠ 三把租约都要在关连接池之前让出来：让位要连得上 Redis，排在后面就
        # 只能等它自然过期，接任的副本白等一整个 TTL
        "lease",
        "lease",
        "lease",
        "ac_source",
        "database",
    ]
    assert consumer.drained == [1.5]


async def test_every_consumer_stops_before_any_resource_closes() -> None:
    """两条消费循环都要先停干净，然后才轮到资源。"""
    ledger: list[str] = []
    container = build_container(ledger)
    first = FakeConsumer(ledger)
    second = FakeConsumer(ledger)
    await run_until_stopped(
        WorkerRuntime(
            consumers=(cast(Consumer, first), cast(Consumer, second)),
            leaseholders=(),
            container=container,
            wait=_immediate,
        ),
        drain_timeout_s=1.5,
    )
    assert ledger[:2] == ["stop", "stop"]
    assert sorted(ledger[2:4]) == ["drain", "drain"]
    assert ledger[4:] == [
        "stream",
        # ⚠ 三把租约都要在关连接池之前让出来：让位要连得上 Redis，排在后面就
        # 只能等它自然过期，接任的副本白等一整个 TTL
        "lease",
        "lease",
        "lease",
        "ac_source",
        "database",
    ]


async def test_resources_are_released_even_when_the_wait_blows_up() -> None:
    """等待期间抛异常也要照常收摊，否则连接池会随进程一起泄漏。"""
    ledger: list[str] = []
    with pytest.raises(RuntimeError):
        await run_until_stopped(
            WorkerRuntime(
                consumers=(cast(Consumer, FakeConsumer(ledger)),),
                leaseholders=(),
                container=build_container(ledger),
                wait=_explode,
            ),
            drain_timeout_s=0.1,
        )
    assert ledger == [
        "stop",
        "drain",
        "stream",
        # ⚠ 三把租约都要在关连接池之前让出来：让位要连得上 Redis，排在后面就
        # 只能等它自然过期，接任的副本白等一整个 TTL
        "lease",
        "lease",
        "lease",
        "ac_source",
        "database",
    ]


async def test_the_lease_is_handed_back_before_any_resource_closes() -> None:
    """⚠ 让位必须排在关资源之前：让位要连得上 Redis。

    排在后面就只能等它自然过期，而接任的副本会白等一整个 TTL——那一整段时间
    现场的点位停在旧值，且没有任何地方说过它不新鲜了。
    """
    ledger: list[str] = []
    container = build_container(ledger)
    holder = FakeLeaseholder(ledger)
    await run_until_stopped(
        WorkerRuntime(
            consumers=(cast(Consumer, FakeConsumer(ledger)),),
            leaseholders=(cast(LeaseHolder, holder),),
            container=container,
            wait=_immediate,
        ),
        drain_timeout_s=0.1,
    )
    assert ledger.index("released") < ledger.index("database")
    assert ledger.index("drain") < ledger.index("released")


async def _immediate() -> None:
    """立刻返回，代替真实的信号等待。"""
    return


async def _explode() -> None:
    """模拟等待期间的意外。"""
    raise RuntimeError("等待被打断")


async def test_serving_wires_the_container_and_shuts_it_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """装配一次、自检一次、收到信号后按序收摊。"""
    ledger: list[str] = []
    container = build_container(ledger)
    monkeypatch.setattr(worker, "build_container", lambda _: container)
    monkeypatch.setattr(
        worker,
        "build_consumer",
        lambda _: cast(ShardConsumer, FakeConsumer(ledger)),
    )

    def fake_trainer(_: Container, *, pool: object) -> TrainingConsumer:
        del pool
        return cast(TrainingConsumer, FakeConsumer(ledger))

    monkeypatch.setattr(worker, "build_trainer", fake_trainer)
    await worker.serve(build_settings(), wait=_immediate)
    assert ledger[:2] == ["stop", "stop"]
    assert sorted(ledger[2:4]) == ["drain", "drain"]
    assert ledger[4:] == [
        "stream",
        # ⚠ 三把租约都要在关连接池之前让出来：让位要连得上 Redis，排在后面就
        # 只能等它自然过期，接任的副本白等一整个 TTL
        "lease",
        "lease",
        "lease",
        "ac_source",
        "database",
    ]


def test_the_worker_role_runs_the_consumer_not_uvicorn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 角色分叉是部署轴：worker 起消费循环，绝不监听 HTTP。"""
    started: list[str] = []
    settings = build_settings()
    monkeypatch.setattr(
        main_module, "load_settings_or_exit", lambda _: settings
    )
    monkeypatch.setattr(worker, "run", lambda _: started.append("worker"))
    monkeypatch.setattr(
        main_module, "serve_http", lambda _: started.append("http")
    )
    main_module.main()
    assert started == ["worker"]


def test_the_api_role_serves_http(monkeypatch: pytest.MonkeyPatch) -> None:
    """api 角色起 uvicorn，不跑任何重任务。"""
    started: list[str] = []
    settings = build_wiring_settings(role=ROLE_API)
    monkeypatch.setattr(
        main_module, "load_settings_or_exit", lambda _: settings
    )
    monkeypatch.setattr(worker, "run", lambda _: started.append("worker"))
    monkeypatch.setattr(
        main_module, "serve_http", lambda _: started.append("http")
    )
    main_module.main()
    assert started == ["http"]
