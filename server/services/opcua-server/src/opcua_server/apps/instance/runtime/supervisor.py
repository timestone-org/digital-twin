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

_logger = get_logger("opcua.supervisor")


class InstanceSupervisor:
    """进程内全部实例的持有者。组合根装配一份。"""

    def __init__(
        self,
        *,
        ports: PortAllocator,
        pki: PkiStore,
        max_instances: int,
    ) -> None:
        """按端口池、证书库与上限初始化。

        Args: ports, pki, max_instances。
        """
        self._ports = ports
        self._pki = pki
        self._max_instances = max_instances
        self._instances: dict[UUID, RunningInstance] = {}

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
        existing = self._instances.get(spec.instance_id)
        if existing is not None:
            return existing
        if len(self._instances) >= self._max_instances:
            raise InstanceLimitReached(
                f"已达单进程实例数上限 {self._max_instances}"
            )
        self._ports.reserve(spec.instance_id, spec.port)
        instance = RunningInstance(spec, pki=self._pki)
        try:
            await instance.start()
        except Exception:
            # 起失败要把端口还回去，否则池会被永远起不来的实例慢慢吃光
            self._ports.release(spec.instance_id)
            raise
        self._instances[spec.instance_id] = instance
        return instance

    async def stop(self, instance_id: UUID) -> None:
        """停一台实例并归还端口。未持有则无操作。

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
