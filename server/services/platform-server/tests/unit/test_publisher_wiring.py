"""publisher 角色的装配与关停顺序。

⚠ 顺序是「停收新活 → drain → 让租约 → 关资源」，不是启动顺序的逆序
（docs/agents/runtime-resilience.md §8）。让租约排在关资源之前：让位比等它
自然过期快一个 TTL，热备能在我们还连得上 Redis 的时候接过去。
"""

from dataclasses import dataclass, field

import pytest

from platform_server import __main__ as main_module
from platform_server import publisher, worker
from platform_server.container import Container
from platform_server.publisher import (
    PublisherProcess,
    _publish_collect,
    _publish_dashboards,
    _reconcile_dashboards,
    build_runtime,
    run_until_stopped,
    selfcheck,
)
from platform_server.settings import ROLE_PUBLISHER, Settings
from unit.wiring_fakes import build_container, build_settings


def publisher_settings() -> Settings:
    """一份 publisher 角色的配置，不连任何依赖。"""
    return build_settings(role=ROLE_PUBLISHER, instance="publisher-1")


@dataclass
class FakeRuntime:
    """把停、drain、让租约三步记进共享账本。"""

    ledger: list[str]
    drained: list[float] = field(default_factory=list[float])

    async def run(self) -> None:
        return None

    def stop(self) -> None:
        self.ledger.append("stop")

    async def drain(self, timeout_s: float) -> None:
        self.ledger.append("drain")
        self.drained.append(timeout_s)

    async def release(self) -> None:
        self.ledger.append("lease_released")


def build_process(ledger: list[str], *, wait: object) -> PublisherProcess:
    """一次 publisher 运行，循环换成记账假件。

    Args: ledger, wait。
    """
    return PublisherProcess(
        # pyright: ignore 的理由 —— 假件满足循环的最小面，容器不做类型校验
        runtime=FakeRuntime(ledger),  # pyright: ignore[reportArgumentType]
        container=build_container(ledger, settings=publisher_settings()),
        wait=wait,  # pyright: ignore[reportArgumentType]
    )


async def _immediate() -> None:
    """立刻返回，代替真实的信号等待。"""
    return


async def _explode() -> None:
    """模拟等待期间的意外。"""
    raise RuntimeError("等待被打断")


@dataclass
class OneShotPublisher:
    """回一份固定报告的发布器。用来钉住两条链路各自的记账口径。"""

    report: object

    async def publish_once(self) -> object:
        return self.report


@dataclass(frozen=True)
class DashboardReport:
    dashboards: int
    items: int


@dataclass(frozen=True)
class CollectReport:
    sources: int
    items: int


@dataclass
class SpyLogger:
    """记下 `info` 的事件名。⚠ 只认事件名：它必须是稳定字面量。"""

    events: list[str] = field(default_factory=list[str])

    def info(self, event: str, message: str, **fields: object) -> None:
        del message, fields
        self.events.append(event)


def spy_on_logger(monkeypatch: pytest.MonkeyPatch) -> SpyLogger:
    """把 publisher 的日志器换成记账假件。

    Args: monkeypatch。
    """
    spy = SpyLogger()
    monkeypatch.setattr(publisher, "_logger", spy)
    return spy


async def test_the_dashboard_lane_logs_only_when_it_pushed_something(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 一拍没推东西也记一条，日志里就全是「推了 0 条」，真事故淹在里面
    spy = spy_on_logger(monkeypatch)
    # pyright: ignore 的理由 —— 假件满足发布器的最小面，函数不做类型校验
    await _publish_dashboards(  # pyright: ignore[reportArgumentType]
        OneShotPublisher(report=DashboardReport(dashboards=0, items=0))
    )
    assert spy.events == []

    await _publish_dashboards(  # pyright: ignore[reportArgumentType]
        OneShotPublisher(report=DashboardReport(dashboards=1, items=3))
    )
    assert spy.events == ["dashboard_values_published"]


async def test_the_collect_lane_logs_only_when_it_pushed_something(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    spy = spy_on_logger(monkeypatch)
    await _publish_collect(  # pyright: ignore[reportArgumentType]
        OneShotPublisher(report=CollectReport(sources=0, items=0))
    )
    assert spy.events == []

    await _publish_collect(  # pyright: ignore[reportArgumentType]
        OneShotPublisher(report=CollectReport(sources=1, items=2))
    )
    # ⚠ 两条链路各有各的事件名：共用一个，日志里就分不出是哪一条在推
    assert spy.events == ["collect_values_published"]


async def test_the_dashboard_lane_reconciles_topics_before_grants() -> None:
    # ⚠ 顺序不能反：授权指向的主题必须先登记，否则 hub 以「主题未登记」拒掉
    # 这次登记，新发布的公开链接要多等一轮才订得上
    ledger: list[str] = []

    @dataclass
    class Recording:
        name: str

        async def reconcile(self) -> tuple[int, int]:
            ledger.append(self.name)
            return 0, 0

    # pyright: ignore 的理由 —— 假件满足对账器的最小面，函数不做类型校验
    await _reconcile_dashboards(
        Recording("topics"),  # pyright: ignore[reportArgumentType]
        Recording("grants"),  # pyright: ignore[reportArgumentType]
    )

    assert ledger == ["topics", "grants"]


def test_both_lanes_are_wired_and_named_apart() -> None:
    # ⚠ 同名的话，一方对账会把另一方的主题当成「多出来的」全部注销掉
    runtime = build_runtime(build_container([], settings=publisher_settings()))
    lanes = runtime._lanes  # 理由 —— 断言装配出的链路
    assert [lane.name for lane in lanes] == ["dashboard", "collect"]


def test_the_publisher_takes_its_pace_from_config() -> None:
    container = build_container([], settings=publisher_settings())
    runtime = build_runtime(container)
    options = runtime._options  # 理由 —— 断言装配出的取值
    # 出厂节拍 2s：它是全平台实时数据的时间分辨率上限，各数据源只会比它慢
    assert options.window_s == 2.0
    assert options.reconcile_interval_s == 5.0


def test_the_shard_ceiling_stays_within_what_the_hub_accepts() -> None:
    # ⚠ 超过 hub 的 REALTIME_MAX_PAYLOAD_ITEMS（默认 500）就是每一批都 413
    settings = publisher_settings()
    assert settings.publish_max_items <= 500


def test_the_lease_lives_longer_than_the_window_that_renews_it() -> None:
    # 续期在每一拍，一次网络抖动不该丢主
    settings = publisher_settings()
    assert settings.publish_lease_ttl_s * 1000 > settings.publish_window_ms


async def test_the_selfcheck_only_logs_and_never_blocks_startup() -> None:
    ledger: list[str] = []
    await selfcheck(build_container(ledger, settings=publisher_settings()))
    assert ledger == []


async def test_shutdown_stops_intake_then_drains_then_yields_the_lease() -> (
    None
):
    ledger: list[str] = []
    process = build_process(ledger, wait=_immediate)
    await run_until_stopped(process, drain_timeout_s=1.5)
    assert ledger == [
        "stop",
        "drain",
        "lease_released",
        "snapshots",
        "lease",
        "viewer_database",
        "database",
    ]


async def test_the_lease_is_handed_back_before_any_pool_closes() -> None:
    # 反过来的话，让位那一步会拿着一个已经关掉的 Redis 连接池
    ledger: list[str] = []
    await run_until_stopped(
        build_process(ledger, wait=_immediate), drain_timeout_s=1.5
    )
    assert ledger.index("lease_released") < ledger.index("database")


async def test_resources_are_released_even_when_the_wait_blows_up() -> None:
    ledger: list[str] = []
    with pytest.raises(RuntimeError):
        await run_until_stopped(
            build_process(ledger, wait=_explode), drain_timeout_s=0.1
        )
    assert ledger[-1] == "database"
    assert "lease_released" in ledger


async def test_the_drain_budget_comes_from_config() -> None:
    ledger: list[str] = []
    process = build_process(ledger, wait=_immediate)
    await run_until_stopped(process, drain_timeout_s=2.5)
    runtime = process.runtime
    assert isinstance(runtime, FakeRuntime)
    assert runtime.drained == [2.5]


async def test_serving_wires_the_container_and_shuts_it_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ledger: list[str] = []
    container: Container = build_container(
        ledger, settings=publisher_settings()
    )
    monkeypatch.setattr(publisher, "build_container", lambda _: container)
    monkeypatch.setattr(
        publisher, "build_runtime", lambda _: FakeRuntime(ledger)
    )
    await publisher.serve(publisher_settings(), wait=_immediate)
    assert ledger[:3] == ["stop", "drain", "lease_released"]


def test_the_publisher_role_runs_the_loop_not_uvicorn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 角色分叉是部署轴：publisher 起发布循环，绝不监听 HTTP。"""
    started: list[str] = []
    monkeypatch.setattr(
        main_module, "load_settings_or_exit", lambda _: publisher_settings()
    )
    monkeypatch.setattr(publisher, "run", lambda _: started.append("publisher"))
    monkeypatch.setattr(worker, "run", lambda _: started.append("worker"))
    monkeypatch.setattr(
        main_module, "serve_http", lambda _: started.append("http")
    )
    main_module.main()
    assert started == ["publisher"]
