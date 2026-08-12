"""实例的生命周期：增删改查与起停。

⚠ 事务边界在这里，不在 FastAPI 依赖里。起停实例是**外部 IO**（bind 端口、
读证书、建地址空间），database-standard 明令禁止把它放进事务——一次起不来的
实例会把数据库连接连同它的锁一起占住整个超时窗口。

因此每个动作的形状都是：短事务读 → 事务外做 IO → 短事务写回状态。
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from lib.logging import get_logger
from lib.web import Page, PageParams
from opcua_server.apps.instance.crud import instance_crud, node_crud
from opcua_server.apps.instance.errors import (
    InstanceLimitReached,
    InstanceNameTaken,
    InstanceNotFound,
    PortPoolExhausted,
)
from opcua_server.apps.instance.models import Instance
from opcua_server.apps.instance.runtime.instance import (
    InstanceSpec,
    SecurityProfile,
)
from opcua_server.apps.instance.runtime.supervisor import InstanceSupervisor
from opcua_server.apps.instance.schemas import (
    InstanceActionOut,
    InstanceCreateIn,
    InstanceOut,
    InstanceUpdateIn,
    PortPoolOut,
)
from opcua_server.apps.instance.services.presenter import (
    definitions_of,
    endpoint_url_of,
    to_instance_out,
)

_logger = get_logger("opcua.instance_service")

# 改了要重启才生效的字段。description 与 is_autostart 不在其中——
# 前者不参与运行、后者只在下次开机时被读到。
RESTART_FIELDS = frozenset(
    {
        "namespace_uri",
        "endpoint_path",
        "security_policies",
        "is_anonymous_allowed",
    }
)


class InstanceService:
    """实例面的业务与事务边界。"""

    def __init__(
        self,
        *,
        database: Database,
        supervisor: InstanceSupervisor,
        advertised_host: str,
    ) -> None:
        """按数据库与实例管理器装配。

        Args: database, supervisor, advertised_host。
        """
        self._database = database
        self._supervisor = supervisor
        self._host = advertised_host

    async def list_instances(
        self, *, keyword: str | None, page: PageParams
    ) -> Page[InstanceOut]:
        """分页列出实例。

        Args: keyword, page。
        """
        async with self._database.session() as session:
            rows, total = await instance_crud.list_page(
                session,
                statement=instance_crud.build_query(keyword=keyword).order_by(
                    Instance.name.asc()
                ),
                offset=page.offset,
                limit=page.size,
            )
            items = [await self._present(session, row) for row in rows]
        return Page[InstanceOut](
            items=items, page=page.page, size=page.size, total=total
        )

    async def get_instance(self, instance_id: uuid.UUID) -> InstanceOut:
        """取实例详情。

        Args: instance_id。
        """
        async with self._database.session() as session:
            row = await self._require(session, instance_id)
            return await self._present(session, row)

    async def create_instance(self, payload: InstanceCreateIn) -> InstanceOut:
        """建实例并从池里分配端口。

        ⚠ 池满一律拒绝，不挑池外端口顶上：池外端口没有容器映射，
        上位机连不上而实例状态显示「运行中」（不变式 6）。

        Args: payload。
        """
        async with self._database.session() as session:
            await self._guard_capacity(session, payload.name)
            row = Instance(
                name=payload.name,
                description=payload.description,
                endpoint_path=payload.endpoint_path,
                port=await self._pick_port(session),
                namespace_uri=payload.namespace_uri,
                security_policies=list(payload.security_policies),
                is_anonymous_allowed=payload.is_anonymous_allowed,
                is_autostart=payload.is_autostart,
                desired_state="stopped",
            )
            instance_crud.add(session, row)
            await session.flush()
            await session.refresh(row)
            return await self._present(session, row)

    async def update_instance(
        self, instance_id: uuid.UUID, payload: InstanceUpdateIn
    ) -> InstanceOut:
        """改实例配置。要重启才生效的改动会把实例置成待重启。

        ⚠ 保存成功不等于已生效。差异由出参的 `pending_fields` 逐项列出——
        接口不会假装改完就生效了（CONTEXT.md §6）。

        Args: instance_id, payload。
        """
        async with self._database.session() as session:
            row = await self._require(session, instance_id)
            changed = _apply_update(row, payload)
            if changed & RESTART_FIELDS:
                row.has_pending_restart = True
            await session.flush()
            await session.refresh(row)
            return await self._present(session, row)

    async def delete_instance(self, instance_id: uuid.UUID) -> None:
        """删实例。在跑就先停——事务外停，再进事务删。

        Args: instance_id。
        """
        async with self._database.session() as session:
            await self._require(session, instance_id)
        await self._supervisor.stop(instance_id)
        async with self._database.session() as session:
            row = await self._require(session, instance_id)
            await instance_crud.delete(session, row)

    async def start_instance(self, instance_id: uuid.UUID) -> InstanceActionOut:
        """起实例。

        Args: instance_id。
        """
        spec = await self._load_spec(instance_id)
        await self._supervisor.start(spec)
        return await self._settle(instance_id, desired="running")

    async def stop_instance(self, instance_id: uuid.UUID) -> InstanceActionOut:
        """停实例。

        Args: instance_id。
        """
        async with self._database.session() as session:
            await self._require(session, instance_id)
        await self._supervisor.stop(instance_id)
        return await self._settle(instance_id, desired="stopped")

    async def restart_instance(
        self, instance_id: uuid.UUID
    ) -> InstanceActionOut:
        """重启实例，让待重启的配置生效。

        Args: instance_id。
        """
        spec = await self._load_spec(instance_id)
        await self._supervisor.stop(instance_id)
        await self._supervisor.start(spec)
        return await self._settle(instance_id, desired="running")

    async def port_pool(self) -> PortPoolOut:
        """端口池占用情况。"""
        allocator = self._supervisor.ports
        async with self._database.session() as session:
            used = len(await instance_crud.taken_ports(session))
            count = await instance_crud.count_all(session)
        total = len(allocator.pool)
        return PortPoolOut(
            total=total,
            used=used,
            available=max(total - used, 0),
            max_instances=self._supervisor.max_instances,
            instance_count=count,
        )

    async def autostart(self) -> None:
        """进程启动时拉起标了自启的实例。

        ⚠ 一台起不来不能挡住其余的：逐台兜异常并记日志，而不是让整个进程
        因为某个实例的端口被别人占了就起不来。
        """
        async with self._database.session() as session:
            rows = await instance_crud.autostart_set(session)
            specs = [await self._spec_of(session, row) for row in rows]
        for spec in specs:
            try:
                await self._supervisor.start(spec)
            except Exception as error:
                _logger.error(
                    "opcua_autostart_failed",
                    "自启实例失败",
                    instance_id=str(spec.instance_id),
                    reason=type(error).__name__,
                )

    async def _settle(
        self, instance_id: uuid.UUID, *, desired: str
    ) -> InstanceActionOut:
        """把期望状态写回，并以端口实况回答「到底在不在跑」。

        Args: instance_id, desired。
        """
        running = self._supervisor.find(instance_id)
        is_running = running is not None and await running.is_listening()
        async with self._database.session() as session:
            row = await self._require(session, instance_id)
            row.desired_state = desired
            if is_running:
                # 起来了就说明库里的配置已经生效，待重启标记随之清掉
                row.has_pending_restart = False
            await session.flush()
            return InstanceActionOut(
                id=row.id,
                is_running=is_running,
                desired_state=row.desired_state,
                endpoint_url=endpoint_url_of(row, self._host),
            )

    async def _load_spec(self, instance_id: uuid.UUID) -> InstanceSpec:
        async with self._database.session() as session:
            row = await self._require(session, instance_id)
            return await self._spec_of(session, row)

    async def _spec_of(
        self, session: AsyncSession, row: Instance
    ) -> InstanceSpec:
        nodes = await node_crud.list_of_instance(session, row.id)
        return InstanceSpec(
            instance_id=row.id,
            name=row.name,
            port=row.port,
            namespace_uri=row.namespace_uri,
            endpoint_path=row.endpoint_path.lstrip("/"),
            nodes=definitions_of(list(nodes)),
            security=SecurityProfile(
                allow_anonymous=row.is_anonymous_allowed,
                allow_insecure_transport="NoSecurity" in row.security_policies,
            ),
        )

    async def _present(
        self, session: AsyncSession, row: Instance
    ) -> InstanceOut:
        running = self._supervisor.find(row.id)
        is_running = running is not None and await running.is_listening()
        return to_instance_out(
            row,
            running=running,
            is_running=is_running,
            node_count=await node_crud.count_of_instance(session, row.id),
            host=self._host,
        )

    async def _guard_capacity(self, session: AsyncSession, name: str) -> None:
        if await instance_crud.get_by_name(session, name) is not None:
            raise InstanceNameTaken(f"实例名 {name} 已被占用")
        if await instance_crud.count_all(session) >= (
            self._supervisor.max_instances
        ):
            raise InstanceLimitReached(
                f"已达实例数上限 {self._supervisor.max_instances}"
            )

    async def _pick_port(self, session: AsyncSession) -> int:
        """从池里挑一个没被占的端口。

        ⚠ 「先查再插」在并发下会重复，真正防重的是 `uq_opcua_instances_port`。
        这里只负责挑，冲突交给唯一约束。

        Args: session。
        """
        taken = await instance_crud.taken_ports(session)
        for port in self._supervisor.ports.pool:
            if port not in taken:
                return port
        raise PortPoolExhausted(
            f"端口池 {len(self._supervisor.ports.pool)} 个端口已全部占用"
        )

    @staticmethod
    async def _require(
        session: AsyncSession, instance_id: uuid.UUID
    ) -> Instance:
        row = await instance_crud.get(session, instance_id)
        if row is None:
            raise InstanceNotFound("实例不存在")
        return row


def _apply_update(row: Instance, payload: InstanceUpdateIn) -> frozenset[str]:
    """把非空字段写进行，返回真正发生变化的字段名。

    ⚠ 只看「传了没有」不够——传了个和现值一样的取值不该被算成改动，
    否则实例会因为一次无意义的保存被标成待重启。

    Args: row, payload。
    """
    changed: set[str] = set()
    for name, value in payload.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        if getattr(row, name) != value:
            setattr(row, name, value)
            changed.add(name)
    return frozenset(changed)
