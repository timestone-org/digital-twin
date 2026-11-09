"""管进程内的 N 个实例：数量上限、端口记账、故障隔离。

⚠ 单实例崩溃不牵连其它实例（CONTEXT.md §4）。因此这里对每个实例的启停都
单独兜异常：一台起不来只让它自己失败，不影响已经在跑的那些。

关停顺序按 runtime-resilience §8：先停收新活（调用方摘就绪），再逐个 drain。
本类只负责第 4 步「释放角色资源」，不自行决定摘流量的时机。
"""

import asyncio
from uuid import UUID

from lib.logging import get_logger
from opcua_server.apps.instance.errors import (
    InstanceLimitReached,
    InstanceNotFound,
)
from opcua_server.apps.instance.runtime.instance import (
    InstanceSpec,
    RunningInstance,
)
from opcua_server.apps.instance.runtime.pki import PkiStore
from opcua_server.apps.instance.runtime.ports import PortAllocator
from opcua_server.apps.instance.runtime.valuewatch import OnValueChange

_logger = get_logger("opcua.supervisor")


class InstanceSupervisor:
    """进程内全部实例的持有者。组合根装配一份。"""

    def __init__(
        self,
        *,
        ports: PortAllocator,
        pki: PkiStore,
        max_instances: int,
        on_value_change: OnValueChange | None = None,
    ) -> None:
        """按端口池、证书库与上限初始化。

        ⚠ `on_value_change` 可缺省：不给就不建值监听。用例里起实例不必都带上
        实时推送那条链路。

        Args: ports, pki, max_instances, on_value_change。
        """
        self._ports = ports
        self._pki = pki
        self._max_instances = max_instances
        self._on_value_change = on_value_change
        self._instances: dict[UUID, RunningInstance] = {}
        # 同一实例的起停串行：双击「启动」时后到的那次要等前一次落定再看
        self._locks: dict[UUID, asyncio.Lock] = {}
        # 正在起、还没登记的实例也占上限的名额，否则并发起停能挤破上限
        self._starting: set[UUID] = set()

    @property
    def ports(self) -> PortAllocator:
        """端口分配表。API 层要靠它报「池里还剩几个」。"""
        return self._ports

    @property
    def max_instances(self) -> int:
        """单进程实例数上限。"""
        return self._max_instances

    def running_ids(self) -> list[UUID]:
        """当前持有的实例 id。"""
        return sorted(self._instances, key=str)

    def count(self) -> int:
        """当前实例数。"""
        return len(self._instances)

    def get(self, instance_id: UUID) -> RunningInstance:
        """取实例，取不到就抛。

        Args: instance_id。
        """
        found = self._instances.get(instance_id)
        if found is None:
            raise InstanceNotFound("实例不存在或未在本进程运行")
        return found

    def find(self, instance_id: UUID) -> RunningInstance | None:
        """取实例，取不到给 None。

        Args: instance_id。
        """
        return self._instances.get(instance_id)

    async def start(self, spec: InstanceSpec) -> RunningInstance:
        """按规格起一台实例。超限或端口不可用即抛，且不留残骸。

        Args: spec。
        """
        instance, _ = await self.launch(spec)
        return instance

    async def launch(self, spec: InstanceSpec) -> tuple[RunningInstance, bool]:
        """起一台实例，并说明这次是否真的新建了服务器。

        ⚠ 已在跑就原样返回且答「没新建」：调用方据此决定能不能清掉待重启
        标记——没重建服务器，库里的新配置就还没生效。

        Args: spec。
        """
        async with self._lock_of(spec.instance_id):
            existing = self._instances.get(spec.instance_id)
            if existing is not None:
                return existing, False
            return await self._start_locked(spec), True

    async def restart(self, spec: InstanceSpec) -> RunningInstance:
        """停掉再按新规格起，整段持有该实例的锁。

        Args: spec。
        """
        async with self._lock_of(spec.instance_id):
            await self._stop_locked(spec.instance_id)
            return await self._start_locked(spec)

    async def stop(self, instance_id: UUID) -> None:
        """停一台实例并归还端口。未持有则无操作。

        Args: instance_id。
        """
        async with self._lock_of(instance_id):
            await self._stop_locked(instance_id)

    def _lock_of(self, instance_id: UUID) -> asyncio.Lock:
        """取该实例的起停锁。

        Args: instance_id。
        """
        return self._locks.setdefault(instance_id, asyncio.Lock())

    async def _start_locked(self, spec: InstanceSpec) -> RunningInstance:
        """起一台实例。调用方持有该实例的锁且确认它没在跑。

        Args: spec。
        """
        if len(self._instances) + len(self._starting) >= self._max_instances:
            raise InstanceLimitReached(
                f"已达单进程实例数上限 {self._max_instances}"
            )
        self._starting.add(spec.instance_id)
        try:
            return await self._build(spec)
        finally:
            self._starting.discard(spec.instance_id)

    async def _build(self, spec: InstanceSpec) -> RunningInstance:
        """记账端口、起服务器并登记。

        Args: spec。
        """
        self._ports.reserve(spec.instance_id, spec.port)
        instance = RunningInstance(
            spec, pki=self._pki, on_value_change=self._on_value_change
        )
        try:
            await instance.start()
        except Exception:
            # 起失败要把端口还回去，否则池会被永远起不来的实例慢慢吃光
            self._ports.release(spec.instance_id)
            raise
        self._instances[spec.instance_id] = instance
        return instance

    async def _stop_locked(self, instance_id: UUID) -> None:
        """停一台实例并归还端口。调用方持有该实例的锁。

        Args: instance_id。
        """
        instance = self._instances.pop(instance_id, None)
        if instance is None:
            return
        try:
            await instance.stop()
        finally:
            self._ports.release(instance_id)

    async def stop_all(self) -> None:
        """关停全部实例。

        ⚠ 一台停不下来不能挡住其余的——`return_exceptions=True` 让每台都走完
        自己的收尾，失败逐条记日志。
        """
        instance_ids = self.running_ids()
        results = await asyncio.gather(
            *(self.stop(instance_id) for instance_id in instance_ids),
            return_exceptions=True,
        )
        for instance_id, result in zip(instance_ids, results, strict=True):
            if isinstance(result, BaseException):
                _logger.error(
                    "opcua_instance_stop_failed",
                    "实例关停失败",
                    instance_id=str(instance_id),
                    reason=type(result).__name__,
                )
