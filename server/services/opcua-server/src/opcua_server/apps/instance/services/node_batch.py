"""内部批量面：一次解析、一次写入一批节点。

⚠ 与公开面的差别只在**失败口径**：这里逐项回执，一项失败不牵连其余项。
调用方（platform-server 的发布循环）一拍要写「区域推荐 + 每个组合各一个」共
1+N 个点位，其中某一个被人删了，不该让另外 N 个也写不进去。

⚠ 但**实例级的失败仍然整条失败**：实例不存在或没在跑时，没有任何一项能成，
逐项报同一个原因只是把同一件事说 N 遍，还会让调用方把它数成「部分成功」。

口径见 docs/AC_PUBLISH_DESIGN.md §2。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from lib.db import Database
from lib.errors import AppError
from lib.logging import get_logger
from opcua_server.apps.instance.crud import instance_crud, node_crud
from opcua_server.apps.instance.errors import (
    InstanceNotFound,
    InstanceNotRunning,
)
from opcua_server.apps.instance.runtime.instance import RunningInstance
from opcua_server.apps.instance.runtime.supervisor import InstanceSupervisor
from opcua_server.apps.instance.schemas import (
    NodeBatchWriteOut,
    NodeResolvedOut,
    NodeResolveOut,
    NodeWriteItemIn,
    NodeWriteResultOut,
)
from opcua_server.apps.instance.services.presenter import (
    ACCESS_LEVEL_WRITE,
    node_id_of,
)

_logger = get_logger("opcua.node_batch")

_MISSING = "节点不存在于该实例"


@dataclass(frozen=True)
class _NodeFacts:
    """一个节点身上批量面要用的那几件事。

    ⚠ 不把 ORM 行带出会话：出了 `async with` 实体已脱离会话，再碰一个没加载过
    的属性就是一次隐式 IO，而那时连接已经还回池里。
    """

    identifier: str
    node_id: str
    data_type: str | None
    is_writable: bool


class NodeBatchService:
    """内部端点的批量解析与批量写值。"""

    def __init__(
        self, *, database: Database, supervisor: InstanceSupervisor
    ) -> None:
        """按数据库与实例管理器装配。

        Args: database, supervisor。
        """
        self._database = database
        self._supervisor = supervisor

    async def resolve(
        self, instance_id: uuid.UUID, ids: Sequence[uuid.UUID]
    ) -> NodeResolveOut:
        """批量取一组节点的定义，顺序与入参一致。

        ⚠ 节点不存在**不是错误**：调用方问的正是「它还在不在」。

        Args: instance_id, ids。
        """
        found = await self._load(instance_id, ids)
        return NodeResolveOut(
            instance_id=instance_id,
            is_running=self._supervisor.find(instance_id) is not None,
            items=[_resolved(node_id, found.get(node_id)) for node_id in ids],
        )

    async def write_many(
        self, instance_id: uuid.UUID, items: Sequence[NodeWriteItemIn]
    ) -> NodeBatchWriteOut:
        """批量写值。只改运行时内存，不落库。

        Args: instance_id, items。
        """
        found = await self._load(instance_id, [item.id for item in items])
        running = self._supervisor.find(instance_id)
        if running is None:
            raise InstanceNotRunning("实例未运行，无法写值")
        results = [
            await _write_one(running, item, found.get(item.id))
            for item in items
        ]
        written = sum(1 for result in results if result.is_written)
        if written != len(results):
            _logger.warning(
                "node_batch_write_partial",
                "批量写值有失败项",
                instance_id=str(instance_id),
                total=len(results),
                written=written,
            )
        return NodeBatchWriteOut(
            instance_id=instance_id, written_count=written, items=results
        )

    async def _load(
        self, instance_id: uuid.UUID, ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, _NodeFacts]:
        """实例必须存在；取回问到的那些节点，按行 id 索引。

        Args: instance_id, ids。
        """
        async with self._database.session() as session:
            if await instance_crud.get(session, instance_id) is None:
                raise InstanceNotFound("实例不存在")
            rows = await node_crud.list_by_ids(
                session, instance_id=instance_id, ids=set(ids)
            )
            return {
                row.id: _NodeFacts(
                    identifier=row.identifier,
                    node_id=node_id_of(row),
                    data_type=row.data_type,
                    is_writable=bool(row.access_level & ACCESS_LEVEL_WRITE),
                )
                for row in rows
            }


def _resolved(node_id: uuid.UUID, facts: _NodeFacts | None) -> NodeResolvedOut:
    """一个节点的解析结果；取不到就只回 id 与 `is_found=false`。

    Args: node_id, facts。
    """
    if facts is None:
        return NodeResolvedOut(id=node_id, is_found=False)
    return NodeResolvedOut(
        id=node_id,
        is_found=True,
        identifier=facts.identifier,
        node_id=facts.node_id,
        data_type=facts.data_type,
        is_writable=facts.is_writable,
    )


async def _write_one(
    running: RunningInstance,
    item: NodeWriteItemIn,
    facts: _NodeFacts | None,
) -> NodeWriteResultOut:
    """写一项。领域异常收成这一项的 `error`，不往外抛。

    ⚠ 只吞 `AppError`：那是我们自己定义的、面向调用方的失败。别的异常
    （连接池、编程错）必须继续往外冒——把它们也吞掉，等于让一次真正的故障
    伪装成「这个点位写不进去」，每分钟重演一次而没人会去看。

    Args: running, item, facts。
    """
    if facts is None:
        return NodeWriteResultOut(id=item.id, is_written=False, error=_MISSING)
    try:
        written = await running.write_value(facts.identifier, item.value)
    except AppError as error:
        return NodeWriteResultOut(
            id=item.id,
            is_written=False,
            identifier=facts.identifier,
            node_id=facts.node_id,
            error=str(error),
        )
    return NodeWriteResultOut(
        id=item.id,
        is_written=True,
        identifier=facts.identifier,
        node_id=facts.node_id,
        value=written,
    )
