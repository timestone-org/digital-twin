"""opc.tcp 端口池的分配与归还。

端口池是**部署期常量**：容器的端口段映射决定了它的取值。池外的端口没有
映射出去，上位机连不上——所以这里宁可响亮失败，也不挑一个池外端口顶上
（CONTEXT.md §2 不变式 6）。
"""

from uuid import UUID

from opcua_server.apps.instance.errors import PortPoolExhausted


class PortAllocator:
    """一个进程内的端口分配表。按实例 id 记账，可归还。

    不是模块级单例——组合根装配一份，测试各造各的。
    """

    def __init__(self, pool: tuple[int, ...]) -> None:
        """按池初始化。

        Args: pool（升序的可用端口）。
        """
        self._pool = tuple(sorted(set(pool)))
        self._by_instance: dict[UUID, int] = {}

    @property
    def pool(self) -> tuple[int, ...]:
        """池内全部端口。"""
        return self._pool

    def contains(self, port: int) -> bool:
        """端口是否落在池内。

        Args: port。
        """
        return port in self._pool

    def taken(self) -> frozenset[int]:
        """已被占用的端口。"""
        return frozenset(self._by_instance.values())

    def assigned(self, instance_id: UUID) -> int | None:
        """该实例已分到的端口；没有则 None。

        Args: instance_id。
        """
        return self._by_instance.get(instance_id)

    def reserve(self, instance_id: UUID, preferred: int | None = None) -> int:
        """给实例分一个端口，重复调用返回同一个。

        `preferred` 用于服务重启后按库里存的端口原样恢复——端口是对外契约的
        一部分，上位机的连接配置里写着它，不能每次重启换一个。

        Args: instance_id, preferred（库里存的端口，None 表示新分配）。
        """
        existing = self._by_instance.get(instance_id)
        if existing is not None:
            return existing
        port = self._pick(instance_id, preferred)
        self._by_instance[instance_id] = port
        return port

    def release(self, instance_id: UUID) -> None:
        """归还该实例占用的端口；未占用则无操作。

        Args: instance_id。
        """
        self._by_instance.pop(instance_id, None)

    def _pick(self, instance_id: UUID, preferred: int | None) -> int:
        """挑一个可用端口，挑不到就抛。

        Args: instance_id, preferred。
        """
        if preferred is not None:
            return self._take_preferred(instance_id, preferred)
        free = [port for port in self._pool if port not in self.taken()]
        if not free:
            raise PortPoolExhausted(
                f"端口池已用尽（共 {len(self._pool)} 个），无法再创建实例"
            )
        return free[0]

    def _take_preferred(self, instance_id: UUID, preferred: int) -> int:
        """按指定端口占用，不可用即抛。

        Args: instance_id, preferred。
        """
        if not self.contains(preferred):
            raise PortPoolExhausted(
                f"端口 {preferred} 不在端口池内，容器没有把它映射出去"
            )
        holder = self._holder_of(preferred)
        if holder is not None and holder != instance_id:
            raise PortPoolExhausted(f"端口 {preferred} 已被另一个实例占用")
        return preferred

    def _holder_of(self, port: int) -> UUID | None:
        """占着这个端口的实例。

        Args: port。
        """
        for instance_id, taken in self._by_instance.items():
            if taken == port:
                return instance_id
        return None
