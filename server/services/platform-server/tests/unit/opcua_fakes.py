"""opcua-server 下发面的进程内假件。

纯进程内对象、零 IO，故住在 unit 层；整装应用的 fixture 与集成用例同样用它替掉
那一跳跨进程调用。

⚠ 它替的是**跨进程的那一跳**，不是被测逻辑：类型校验、哨兵值与逐项失败的处置
走的都还是真代码，用例因此仍然拦得住口径写错。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field

from platform_server.opcua import NodeWrite, ResolvedNode, WriteResult


@dataclass
class FakeNodeWriter:
    """替掉 opcua-server 的假下发面，满足 `NodeWriter`。

    ⚠ 它替的是**跨进程调用**，不是被测逻辑：类型校验、哨兵值、逐项失败的处置
    走的都还是真的 `ac_publication_service` / `ac_publish_service`。

    用例往 `nodes` 里填「这台实例上有哪些节点、各是什么类型」，
    往 `failure` 里填「这一次打不通」。
    """

    # (实例 id, 节点 id) → (数据类型, 可不可写)
    nodes: dict[tuple[uuid.UUID, uuid.UUID], tuple[str, bool]] = field(
        default_factory=dict
    )
    writes: list[tuple[uuid.UUID, list[NodeWrite]]] = field(
        default_factory=list
    )
    keys: list[str | None] = field(default_factory=list)
    failure: Exception | None = None
    write_errors: dict[uuid.UUID, str] = field(default_factory=dict)

    # 关停钩子会关它——假件也得关得掉，否则「装了就要关」那条契约测不出来
    is_closed: bool = False

    async def close(self) -> None:
        """记下自己被关过。"""
        self.is_closed = True

    def add(
        self,
        instance_id: uuid.UUID,
        node_id: uuid.UUID,
        *,
        data_type: str,
        is_writable: bool = True,
    ) -> None:
        """登记一个节点。

        Args: instance_id, node_id, data_type, is_writable。
        """
        self.nodes[(instance_id, node_id)] = (data_type, is_writable)

    async def resolve(
        self, *, instance_id: uuid.UUID, node_ids: Sequence[uuid.UUID]
    ) -> list[ResolvedNode]:
        if self.failure is not None:
            raise self.failure
        return [self._resolved(instance_id, node_id) for node_id in node_ids]

    def _resolved(
        self, instance_id: uuid.UUID, node_id: uuid.UUID
    ) -> ResolvedNode:
        found = self.nodes.get((instance_id, node_id))
        if found is None:
            return ResolvedNode(
                id=node_id,
                is_found=False,
                identifier=None,
                node_id=None,
                data_type=None,
                is_writable=False,
            )
        data_type, is_writable = found
        return ResolvedNode(
            id=node_id,
            is_found=True,
            identifier=f"N-{node_id.hex[:8]}",
            node_id=f"ns=2;s=N-{node_id.hex[:8]}",
            data_type=data_type,
            is_writable=is_writable,
        )

    async def write(
        self,
        *,
        instance_id: uuid.UUID,
        items: Sequence[NodeWrite],
        idempotency_key: str | None = None,
    ) -> list[WriteResult]:
        if self.failure is not None:
            raise self.failure
        self.writes.append((instance_id, list(items)))
        self.keys.append(idempotency_key)
        return [self._written(item) for item in items]

    def _written(self, item: NodeWrite) -> WriteResult:
        reason = self.write_errors.get(item.id)
        identifier = f"N-{item.id.hex[:8]}"
        if reason is not None:
            return WriteResult(
                id=item.id,
                is_written=False,
                identifier=identifier,
                value=None,
                error=reason,
            )
        return WriteResult(
            id=item.id,
            is_written=True,
            identifier=identifier,
            value=item.value,
            error=None,
        )
