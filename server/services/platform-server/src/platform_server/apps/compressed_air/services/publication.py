"""按采集快照向已绑定的 OPC UA 推荐节点发布布尔值。"""

import asyncio
from collections.abc import Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass
from math import isfinite
from typing import Literal, Protocol
from uuid import UUID

from lib.errors import DependencyUnavailable
from lib.logging import (
    bind_log_context,
    get_logger,
    reset_log_context,
)
from lib.utils.ids import uuid7
from platform_server.apps.collect.services.snapshot_source import (
    PointReading,
    SnapshotSource,
)
from platform_server.apps.compressed_air.config import CompressedAirConfig
from platform_server.apps.compressed_air.models import Curves
from platform_server.apps.compressed_air.services.dispatch import recommend
from platform_server.lease import Lease
from platform_server.opcua import NodeWrite, NodeWriter
from timeseries import split_node_key

_logger = get_logger("platform.compressed_air.publication")
INTERVAL_S = 15.0
BUDGET_S = 12.0
LEASE_TTL_S = 35
CALIBRATION_REFRESH_S = 900.0
CALIBRATION_BUDGET_S = 6.0


class OnlineSources(Protocol):
    """采集源在线状态读侧。"""

    async def online_ids(
        self, source_ids: Sequence[UUID]
    ) -> frozenset[UUID]: ...


class CalibrationSource(Protocol):
    """从站点历史更新代表工况。"""

    async def __call__(self) -> Curves: ...


@dataclass(frozen=True)
class PublicationSources:
    """推荐使用的当前工况与历史曲线。"""

    snapshots: SnapshotSource
    states: OnlineSources
    calibration: CalibrationSource


type Outcome = Literal[
    "input_unavailable",
    "idle",
    "machines_unavailable",
    "curves_unavailable",
    "out_of_range",
    "recommended",
]


@dataclass(frozen=True)
class Decision:
    """一次推荐的目标流量、组合与结果。"""

    demand: float | None
    outcome: Outcome
    machines: tuple[int, ...] = ()

    def status_text(self, *, is_estimated: bool) -> str:
        """生成大屏上的推荐依据。Args: is_estimated。"""
        if self.demand is None:
            return "等待四台机组有效采集" if is_estimated else "等待有效需气量"
        total = f"{self.demand:.1f} m³/min"
        suffix = {
            "idle": " · 当前无产气",
            "machines_unavailable": " · 无可用机组",
            "curves_unavailable": " · 标定曲线未就绪",
            "out_of_range": " · 无可行组合",
        }.get(self.outcome, "")
        return total + suffix


class CompressedAirPublisher:
    """worker 单活循环，独立于大屏是否有人观看。"""

    def __init__(
        self,
        config: CompressedAirConfig,
        sources: PublicationSources,
        nodes: NodeWriter,
        lease: Lease,
    ) -> None:
        """接入推荐发布端口。Args: config, sources, nodes, lease。"""
        self._config = config
        self._sources = sources
        self._nodes = nodes
        self._lease = lease
        self._curves: Curves = {}
        self._next_refresh = 0.0
        self._stopped = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()
        self._is_leader = False

    async def run(self) -> None:
        """周期执行推荐，单拍失败等待下一拍的新计算。"""
        while not self._stopped.is_set():
            self._idle.clear()
            try:
                async with asyncio.timeout(BUDGET_S):
                    await self.tick()
            except Exception as error:
                _logger.warning(
                    "compressed_air_publish_failed",
                    "空压站推荐未确认下发",
                    error_type=type(error).__name__,
                )
            finally:
                self._idle.set()
            with suppress(TimeoutError):
                await asyncio.wait_for(self._stopped.wait(), timeout=INTERVAL_S)

    async def tick(self) -> None:
        """确认租约、现场输入与目标节点后执行一拍。"""
        trace_id = uuid7().hex
        token = bind_log_context(
            trace_id=trace_id,
            span_id=trace_id[16:],
            route="compressed_air.tick",
        )
        try:
            if await self._hold_lease():
                await self._publish()
        finally:
            reset_log_context(token)

    async def _hold_lease(self) -> bool:
        """续租或接管；续租失败即停止本拍。"""
        self._is_leader = (
            await self._lease.renew()
            if self._is_leader
            else await self._lease.acquire()
        )
        return self._is_leader

    async def _publish(self) -> None:
        """读取并校验推荐目标，再写入本轮组合与状态。"""
        config = self._config
        curves = await self._latest_curves()
        decision = _decide(config, await self._read_inputs(), curves)
        writes = _write_items(config, decision)
        if not await self._targets_ready() or not await self._hold_lease():
            return
        receipts = await self._nodes.write(
            instance_id=config.opcua_instance_id,
            items=writes,
            idempotency_key=str(uuid7()),
        )
        confirmed = {
            item.id: item.value for item in receipts if item.is_written
        }
        if len(receipts) != len(writes) or not all(
            type(confirmed.get(item.id)) is type(item.value)
            and confirmed[item.id] == item.value
            for item in writes
        ):
            _logger.warning(
                "compressed_air_publish_unconfirmed", "推荐输出未全部确认"
            )
            return
        _logger.info(
            "compressed_air_published",
            "发布空压站推荐点位",
            has_recommendation=bool(decision.machines),
            machine_count=len(decision.machines),
            demand_m3_min=decision.demand,
            outcome=decision.outcome,
        )

    async def _latest_curves(self) -> Curves:
        """按周期从真实归档更新模型。"""
        loop = asyncio.get_running_loop()
        if loop.time() >= self._next_refresh:
            self._curves = {}
            try:
                async with asyncio.timeout(CALIBRATION_BUDGET_S):
                    self._curves = await self._sources.calibration()
            except Exception as error:
                _logger.warning(
                    "compressed_air_calibration_failed",
                    "空压站标定暂不可用",
                    error_type=type(error).__name__,
                )
                self._next_refresh = loop.time() + INTERVAL_S
            else:
                self._next_refresh = loop.time() + CALIBRATION_REFRESH_S
        return self._curves

    async def _read_inputs(self) -> dict[str, PointReading]:
        """仅消费当前属主、在线数据源的输入。"""
        keys = self._config.input_keys
        owners = {key: split_node_key(key)[0] for key in keys}
        try:
            online = await self._sources.states.online_ids(
                list(set(owners.values()))
            )
            return await self._sources.snapshots.read(
                [key for key in keys if owners[key] in online]
            )
        except (DependencyUnavailable, TimeoutError) as error:
            _logger.warning(
                "compressed_air_inputs_unavailable",
                "空压站当前读数暂不可用",
                error_type=type(error).__name__,
            )
            return {}

    async def _targets_ready(self) -> bool:
        """确认每个目标可写并且类型匹配。"""
        config = self._config
        expected = dict.fromkeys(config.recommendation_node_ids, "boolean")
        status = config.recommendation_status_node_id
        if status is not None:
            expected[status] = "string"
        targets = await self._nodes.resolve(
            instance_id=config.opcua_instance_id,
            node_ids=config.output_node_ids,
        )
        ready = {
            item.id: item.data_type
            for item in targets
            if item.is_found and item.is_writable
        }
        if len(targets) == len(expected) and ready == expected:
            return True
        _logger.warning(
            "compressed_air_targets_invalid", "空压站推荐点位缺失或类型不匹配"
        )
        return False

    def stop(self) -> None:
        """停止接收下一拍。"""
        self._stopped.set()

    async def drain(self, timeout_s: float) -> None:
        """在共享关停预算内等这一拍结束。Args: timeout_s。"""
        with suppress(TimeoutError):
            await asyncio.wait_for(self._idle.wait(), timeout=timeout_s)

    async def release(self) -> None:
        """让出租约并关闭自己的租约连接。"""
        try:
            if self._is_leader:
                await self._lease.release()
        finally:
            self._is_leader = False
            await self._lease.close()


def _current(reading: PointReading | None) -> object:
    """仅打开质量良好的当前值。Args: reading。"""
    if reading is not None and reading.is_current and reading.quality == "good":
        return reading.value
    return None


def _nonnegative(reading: PointReading | None) -> float | None:
    """读取当前有效的非负数。Args: reading。"""
    value = _current(reading)
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        return None
    try:
        number = float(value)
    except OverflowError:
        return None
    return number if isfinite(number) and number >= 0 else None


def current_demand(
    config: CompressedAirConfig, readings: Mapping[str, PointReading]
) -> float | None:
    """读取单点目标或由四台机组估算当前产气总量。Args: config, readings。"""
    if config.demand_node_key is not None:
        return _nonnegative(readings.get(config.demand_node_key))
    if config.estimated_flow_points is None:
        return None
    total = 0.0
    for points in config.estimated_flow_points:
        power = _nonnegative(readings.get(points.power))
        ratio = _nonnegative(readings.get(points.site_qdb))
        if power is None or ratio is None:
            return None
        total += power * ratio / 60
    return total if isfinite(total) else None


def _decide(
    config: CompressedAirConfig,
    readings: Mapping[str, PointReading],
    curves: Curves,
) -> Decision:
    """从当前流量与已标定曲线构造推荐。Args: config, readings, curves。"""
    demand = current_demand(config, readings)
    if demand is None:
        return Decision(demand, "input_unavailable")
    if demand == 0:
        return Decision(demand, "idle")
    available = tuple(
        index
        for index in config.candidate_machines
        if (key := config.available_node_keys[index - 1]) is None
        or _current(readings.get(key)) is True
    )
    if not available:
        return Decision(demand, "machines_unavailable")
    if any(not curves.get(index) for index in available):
        return Decision(demand, "curves_unavailable")
    recommendation = recommend(demand, available, curves)
    if recommendation is None:
        return Decision(demand, "out_of_range")
    return Decision(demand, "recommended", recommendation.machines)


def _write_items(
    config: CompressedAirConfig, decision: Decision
) -> tuple[NodeWrite, ...]:
    """将推荐组合及可选状态转换为写入值。Args: config, decision。"""
    writes = tuple(
        NodeWrite(node_id, index in decision.machines)
        for index, node_id in enumerate(config.recommendation_node_ids, 1)
    )
    status = config.recommendation_status_node_id
    if status is None:
        return writes
    text = decision.status_text(
        is_estimated=config.estimated_flow_points is not None
    )
    return (*writes, NodeWrite(status, text))


def recommended_machines(
    config: CompressedAirConfig,
    readings: Mapping[str, PointReading],
    curves: Curves,
) -> tuple[int, ...]:
    """无有效需求或可行解时撤销推荐。Args: config, readings, curves。"""
    return _decide(config, readings, curves).machines
