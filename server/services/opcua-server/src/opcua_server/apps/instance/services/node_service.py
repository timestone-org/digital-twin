"""地址空间节点的增删改查与值读写。

⚠ **值不落库**（不变式 1、2）：写值只改运行时内存，`opcua_nodes.initial_value`
是初值不是当前值。进程重启后所有节点回到初值，这是明确语义。

⚠ **加/删节点与改 access_level 是热生效**（CONTEXT.md §6）：实例在跑就当场
改地址空间，加完的节点即刻可被上位机读到、删掉的即刻读不到、改过可写位的
即刻按新口径放行或拒绝，会话不断。为常规操作重启实例会踢掉全部上位机会话。

⚠ **地址空间是外部 IO，绝不放进数据库事务**（database-standard）。因此两个
方向的顺序是反的，都为了让失败留下可恢复的状态：

- 加：先短事务落库，再改地址空间；地址空间失败则补偿删除那一行。
- 删：先摘地址空间，再删库；库删失败时节点仍在库里，下次启动会重新建出来。
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from lib.errors import ValidationFailed
from lib.logging import get_logger
from lib.web import Page, PageParams
from opcua_server.apps.instance.crud import instance_crud, node_crud
from opcua_server.apps.instance.errors import (
    InstanceNotFound,
    InstanceNotRunning,
    NodeIdentifierTaken,
    NodeNotFound,
)
from opcua_server.apps.instance.models import Instance, Node
from opcua_server.apps.instance.runtime.addressspace import NodeDefinition
from opcua_server.apps.instance.runtime.supervisor import InstanceSupervisor
from opcua_server.apps.instance.schemas import (
    NodeCreateIn,
    NodeMutationOut,
    NodeOut,
    NodeUpdateIn,
    NodeValueOut,
    NodeWriteOut,
)
from opcua_server.apps.instance.services.presenter import (
    ACCESS_LEVEL_WRITE,
    definition_of,
    node_id_of,
    to_node_out,
    unwrap_value,
    wrap_value,
)

_logger = get_logger("opcua.nodes")

# 改了要重启才生效的节点字段。description 不参与地址空间构建。
RESTART_FIELDS = frozenset({"browse_name", "data_type", "initial_value"})
# 热生效档的字段：实例在跑就当场改运行中的地址空间（CONTEXT.md §6）
HOT_FIELD_ACCESS_LEVEL = "access_level"
# 方法节点要绑定服务端回调，本服务没有可绑定的用户代码（CONTEXT.md §3）
NODE_CLASS_METHOD = "method"


class NodeService:
    """节点面的业务与事务边界。"""

    def __init__(
        self,
        *,
        database: Database,
        supervisor: InstanceSupervisor,
    ) -> None:
        """按数据库与实例管理器装配。

        Args: database, supervisor。
        """
        self._database = database
        self._supervisor = supervisor
        self._sync = NodeRuntimeSync(database=database, supervisor=supervisor)

    async def list_nodes(
        self,
        instance_id: uuid.UUID,
        *,
        keyword: str | None,
        page: PageParams,
    ) -> Page[NodeOut]:
        """分页列出某实例的节点。

        Args: instance_id, keyword, page。
        """
        async with self._database.session() as session:
            await self._require_instance(session, instance_id)
            rows, total = await node_crud.list_page(
                session,
                statement=node_crud.build_query(
                    instance_id=instance_id, keyword=keyword
                ).order_by(Node.browse_name.asc()),
                offset=page.offset,
                limit=page.size,
            )
            items = [to_node_out(row) for row in rows]
        return Page[NodeOut](
            items=items, page=page.page, size=page.size, total=total
        )

    async def get_node(
        self, instance_id: uuid.UUID, node_id: uuid.UUID
    ) -> NodeOut:
        """取节点定义。

        Args: instance_id, node_id。
        """
        async with self._database.session() as session:
            return to_node_out(
                await self._require_node(session, instance_id, node_id)
            )

    async def create_node(
        self, instance_id: uuid.UUID, payload: NodeCreateIn
    ) -> NodeMutationOut:
        """建节点。实例在跑就当场加进地址空间，不必重启。

        ⚠ `identifier` 冲突只报错，绝不自动改名（不变式 3）：上位系统的组态
        硬编码着 NodeId，服务端替它换一个，现场所有组态一起废。

        Args: instance_id, payload。
        """
        if payload.node_class == NODE_CLASS_METHOD:
            raise ValidationFailed(
                "方法节点需要绑定服务端回调，本服务不提供可绑定的用户代码，"
                "因此不支持 node_class=method"
            )
        async with self._database.session() as session:
            await self._require_instance(session, instance_id)
            await self._guard_identifier(
                session, instance_id, payload.identifier
            )
            parent = await self._parent_identifier(
                session, instance_id, payload.parent_id
            )
            row = Node(
                instance_id=instance_id,
                parent_id=payload.parent_id,
                browse_name=payload.browse_name,
                node_class=payload.node_class,
                identifier=payload.identifier,
                identifier_kind=payload.identifier_kind,
                data_type=payload.data_type,
                value_rank=payload.value_rank,
                array_dimensions=payload.array_dimensions,
                access_level=payload.access_level,
                initial_value=wrap_value(payload.initial_value),
                description=payload.description,
            )
            node_crud.add(session, row)
            await session.flush()
            await session.refresh(row)
            created, node_id = to_node_out(row), row.id
            definition = definition_of(row, parent)
        await self._sync.activate(instance_id, node_id, definition)
        return NodeMutationOut(node=created, pending_fields=[])

    async def update_node(
        self,
        instance_id: uuid.UUID,
        node_id: uuid.UUID,
        payload: NodeUpdateIn,
    ) -> NodeMutationOut:
        """改节点定义。标识不可改——要换只能删了重建。

        `access_level` 是热生效档：实例在跑就当场改运行中地址空间的可写位；
        热改失败时保存不回滚，实例转待重启并把它计入 `pending_fields`。

        Args: instance_id, node_id, payload。
        """
        async with self._database.session() as session:
            instance = await self._require_instance(session, instance_id)
            row = await self._require_node(session, instance_id, node_id)
            changed = _apply_node_update(row, payload)
            pending: list[str] = []
            if changed & RESTART_FIELDS:
                pending = self._mark_pending(
                    instance, *sorted(changed & RESTART_FIELDS)
                )
            await session.flush()
            await session.refresh(row)
            updated = to_node_out(row)
            identifier = row.identifier
            is_writable = bool(row.access_level & ACCESS_LEVEL_WRITE)
        # ⚠ 热改在事务之外：地址空间是外部 IO，绝不放进数据库事务
        if HOT_FIELD_ACCESS_LEVEL in changed:
            applied = await self._sync.rewrite_access(
                instance_id, identifier, is_writable=is_writable
            )
            if not applied:
                pending = sorted({*pending, HOT_FIELD_ACCESS_LEVEL})
        return NodeMutationOut(node=updated, pending_fields=pending)

    async def delete_node(
        self, instance_id: uuid.UUID, node_id: uuid.UUID
    ) -> list[str]:
        """删节点。实例在跑就当场从地址空间摘掉，不必重启。

        ⚠ 顺序与建节点相反：**先摘地址空间再删库**。反过来的话，库删成功而
        地址空间摘失败，就成了「管理面没有、上位机还读得到」——那是最坏的
        一种不一致，因为没有任何一侧的重启能自愈它。

        Args: instance_id, node_id。
        """
        async with self._database.session() as session:
            await self._require_instance(session, instance_id)
            row = await self._require_node(session, instance_id, node_id)
            identifier = row.identifier
        await self._sync.deactivate(instance_id, identifier)
        async with self._database.session() as session:
            row = await self._require_node(session, instance_id, node_id)
            await node_crud.delete(session, row)
        return []

    async def read_value(
        self, instance_id: uuid.UUID, node_id: uuid.UUID
    ) -> NodeValueOut:
        """读节点当前值。

        ⚠ 实例没在跑时读到的是**初值**而不是运行时的值，出参用 `is_live`
        标注这一点——不标注的话调用方会把配置当成现场读数。

        Args: instance_id, node_id。
        """
        async with self._database.session() as session:
            row = await self._require_node(session, instance_id, node_id)
            identifier, data_type = row.identifier, row.data_type
            node_id_text = node_id_of(row)
            fallback = unwrap_value(row.initial_value)
        running = self._supervisor.find(instance_id)
        if running is None:
            return NodeValueOut(
                identifier=identifier,
                node_id=node_id_text,
                value=fallback,
                data_type=data_type,
                is_live=False,
            )
        return NodeValueOut(
            identifier=identifier,
            node_id=node_id_text,
            value=await running.read_value(identifier),
            data_type=data_type,
            is_live=True,
        )

    async def write_value(
        self, instance_id: uuid.UUID, node_id: uuid.UUID, value: object
    ) -> NodeWriteOut:
        """写节点值。**只改运行时内存，不写库。**

        Args: instance_id, node_id, value。
        """
        async with self._database.session() as session:
            row = await self._require_node(session, instance_id, node_id)
            identifier, node_id_text = row.identifier, node_id_of(row)
        running = self._supervisor.find(instance_id)
        if running is None:
            raise InstanceNotRunning("实例未运行，无法写值")
        written = await running.write_value(identifier, value)
        # ⚠ 这里**不**记值变化：地址空间上有一条内部订阅，管理面与上位机两条
        # 写入路径都被它看见（runtime/valuewatch.py）。在这里再记一次，就有了
        # 两个真源，将来新增写入路径时又会漏掉一个。
        return NodeWriteOut(
            identifier=identifier, node_id=node_id_text, value=written
        )

    def _mark_pending(self, instance: Instance, *fields: str) -> list[str]:
        """实例在跑才谈得上「未生效」；没在跑的下次起来读的就是新配置。

        Args: instance, fields。
        """
        if self._supervisor.find(instance.id) is None:
            return []
        instance.has_pending_restart = True
        return sorted(fields)

    @staticmethod
    async def _parent_identifier(
        session: AsyncSession,
        instance_id: uuid.UUID,
        parent_id: uuid.UUID | None,
    ) -> str | None:
        """把父节点的行 id 翻成它的标识；父节点不存在即抛。

        ⚠ 不能默默当成「没有父节点」——那会把节点静默挂到 Objects 根下，
        上位机按 BrowsePath 寻址时全部落空。

        Args: session, instance_id, parent_id。
        """
        if parent_id is None:
            return None
        parent = await node_crud.get(session, parent_id)
        if parent is None or parent.instance_id != instance_id:
            raise NodeNotFound("父节点不存在于该实例")
        return parent.identifier

    @staticmethod
    async def _guard_identifier(
        session: AsyncSession, instance_id: uuid.UUID, identifier: str
    ) -> None:
        existing = await node_crud.get_by_identifier(
            session, instance_id=instance_id, identifier=identifier
        )
        if existing is not None:
            raise NodeIdentifierTaken(f"标识 {identifier} 在本实例已被占用")

    @staticmethod
    async def _require_instance(
        session: AsyncSession, instance_id: uuid.UUID
    ) -> Instance:
        row = await instance_crud.get(session, instance_id)
        if row is None:
            raise InstanceNotFound("实例不存在")
        return row

    @staticmethod
    async def _require_node(
        session: AsyncSession, instance_id: uuid.UUID, node_id: uuid.UUID
    ) -> Node:
        row = await node_crud.get(session, node_id)
        if row is None or row.instance_id != instance_id:
            raise NodeNotFound("节点不存在于该实例")
        return row


def _apply_node_update(row: Node, payload: NodeUpdateIn) -> frozenset[str]:
    """把非空字段写进行，返回真正发生变化的字段名。

    Args: row, payload。
    """
    changed: set[str] = set()
    fields = payload.model_dump(exclude_unset=True)
    for name, value in fields.items():
        if value is None:
            continue
        current = (
            unwrap_value(row.initial_value)
            if name == "initial_value"
            else getattr(row, name)
        )
        if current == value:
            continue
        setattr(
            row,
            name,
            wrap_value(value) if name == "initial_value" else value,
        )
        changed.add(name)
    return frozenset(changed)


class NodeRuntimeSync:
    """把落库的节点变更同步到运行中的地址空间。

    单独成类不是为了拆行数：**库与地址空间之间的一致性**自成一件事，
    它的两个方向顺序相反、失败处置也不同，混在增删改查里读不出这层意图。
    """

    def __init__(
        self, *, database: Database, supervisor: InstanceSupervisor
    ) -> None:
        """按数据库与实例管理器装配。

        Args: database, supervisor。
        """
        self._database = database
        self._supervisor = supervisor

    async def activate(
        self,
        instance_id: uuid.UUID,
        node_id: uuid.UUID,
        definition: NodeDefinition,
    ) -> None:
        """把刚落库的节点加进运行中的地址空间；失败则补偿删除那一行。

        ⚠ 不补偿就会留下「库里有、地址空间没有」的半成品：管理面列得出它，
        上位机却读不到，而且要等到下次重启才会自愈。

        Args: instance_id, node_id, definition。
        """
        running = self._supervisor.find(instance_id)
        if running is None:
            return
        try:
            await running.add_node(definition)
        except Exception:
            await self.discard(node_id)
            raise

    async def discard(self, node_id: uuid.UUID) -> None:
        """补偿删除。它自己失败也不能盖住原始异常，所以只记日志。

        Args: node_id。
        """
        try:
            async with self._database.session() as session:
                row = await node_crud.get(session, node_id)
                if row is not None:
                    await node_crud.delete(session, row)
        except Exception as error:
            _logger.error(
                "opcua_node_compensation_failed",
                "热加节点失败后未能回滚落库，重启后该节点会出现",
                node_id=str(node_id),
                reason=type(error).__name__,
            )

    async def deactivate(self, instance_id: uuid.UUID, identifier: str) -> None:
        """从运行中的地址空间摘掉节点。

        ⚠ 运行时说它不在，就当作已达目的地继续删库：否则一次不一致会让这行
        **永远删不掉**。但要记一条——不一致本身是要查的。

        Args: instance_id, identifier。
        """
        running = self._supervisor.find(instance_id)
        if running is None:
            return
        try:
            await running.remove_node(identifier)
        except NodeNotFound:
            _logger.warning(
                "opcua_node_absent_in_runtime",
                "库里有而地址空间没有，按已删除继续",
                instance_id=str(instance_id),
                identifier=identifier,
            )

    async def rewrite_access(
        self, instance_id: uuid.UUID, identifier: str, *, is_writable: bool
    ) -> bool:
        """把新的可写位热改进运行中的地址空间；已生效或无需生效返回 True。

        ⚠ 失败**不回滚**已落库的配置——值是合法的，错的只是「还没生效」。
        降级方向显式：置实例待重启，由调用方把 access_level 计入
        pending_fields，绝不静默假装已生效（CONTEXT.md §6）。

        Args: instance_id, identifier, is_writable。
        """
        running = self._supervisor.find(instance_id)
        if running is None:
            return True
        try:
            await running.set_node_writable(identifier, is_writable=is_writable)
        except Exception as error:
            _logger.warning(
                "opcua_access_rewrite_degraded",
                "热改可写位失败，已转待重启生效",
                instance_id=str(instance_id),
                identifier=identifier,
                reason=type(error).__name__,
            )
            await self._flag_restart(instance_id)
            return False
        return True

    async def _flag_restart(self, instance_id: uuid.UUID) -> None:
        """把实例置成待重启。行已不在就算了——整台实例都删了。

        Args: instance_id。
        """
        async with self._database.session() as session:
            row = await instance_crud.get(session, instance_id)
            if row is not None:
                row.has_pending_restart = True
