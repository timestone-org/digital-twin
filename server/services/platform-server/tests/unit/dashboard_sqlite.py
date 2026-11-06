"""大屏写路径用例的 SQLite 底座：外键与唯一约束照真，语句可按 PG 方言核对。

⚠ 只验写入顺序与约束：SQLite 的外键同样逐条语句立即生效，撞不撞键与生产一致。
真实行锁的互斥不在这里验，见 `integration/test_dashboard_write_lock.py`。
"""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, cast

from sqlalchemy import (
    CheckConstraint,
    MetaData,
    Table,
    event,
    text,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    create_async_engine,
)
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import ORMExecuteState
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import DefaultClause
from sqlalchemy.sql.compiler import TypeCompiler
from sqlalchemy.sql.elements import ClauseElement

from platform_server.apps.dashboard.models import (
    Dashboard,
    DashboardBinding,
    DashboardNode,
    DashboardProject,
)
from platform_server.apps.dashboard.services.module_catalog import (
    load_module_catalog,
)
from platform_server.apps.dashboard.services.point_catalog import (
    StaticPointCatalog,
)
from platform_server.apps.dashboard.services.validation import (
    ValidationContext,
)
from platform_server.settings import DB_SCHEMA

CONTEXT = ValidationContext(
    catalog=load_module_catalog(), points=StaticPointCatalog()
)
_TABLES: tuple[Table, ...] = tuple(
    Dashboard.metadata.tables[f"{DB_SCHEMA}.{name}"]
    for name in (
        "dashboard_projects",
        "dashboards",
        "dashboard_nodes",
        "dashboard_bindings",
    )
)


@compiles(JSONB, "sqlite")
def jsonb_on_sqlite(
    _element: JSONB, _compiler: TypeCompiler, **_kwargs: Any
) -> str:
    """让 PG 专属列类型在 SQLite 上建得出来。"""
    return "JSON"


def _sqlite_copy() -> MetaData:
    """把四张大屏表抄成 SQLite 建得出来的形状：留键与外键，去 PG 专属默认值。"""
    metadata = MetaData()
    for table in _TABLES:
        copied = table.to_metadata(metadata)
        for constraint in list(copied.constraints):
            if isinstance(constraint, CheckConstraint):
                copied.constraints.remove(constraint)
        for column in copied.columns:
            default = column.server_default
            if isinstance(default, DefaultClause) and "::" in str(default.arg):
                column.server_default = DefaultClause(text("'{}'"))
    return metadata


async def open_engine() -> AsyncIterator[AsyncEngine]:
    """起一个内存库并建好表，用完释放。夹具用。"""
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        execution_options={"schema_translate_map": {DB_SCHEMA: None}},
    )

    def enforce_foreign_keys(connection: Any, _record: Any) -> None:
        connection.execute("PRAGMA foreign_keys=ON")

    event.listen(engine.sync_engine, "connect", enforce_foreign_keys)
    async with engine.begin() as connection:
        await connection.run_sync(_sqlite_copy().create_all)
    yield engine
    await engine.dispose()


@dataclass
class StatementLog:
    """记下一个会话发出的 ORM 语句，渲染成 PG 方言的 SQL。"""

    statements: list[str] = field(default_factory=list[str])

    def attach(self, session: AsyncSession) -> None:
        """挂到会话上。Args: session。"""

        def record(state: ORMExecuteState) -> None:
            statement = cast("ClauseElement", state.statement)
            compiled = statement.compile(dialect=postgresql.dialect())
            self.statements.append(str(compiled))

        event.listen(session.sync_session, "do_orm_execute", record)

    def first_lock_at(self) -> int | None:
        """第一条锁大屏行的语句在第几条，没有回 None。"""
        for position, statement in enumerate(self.statements):
            if "FOR UPDATE" in statement and "FROM platform.dashboards" in (
                statement
            ):
                return position
        return None


async def seed_dashboard(session: AsyncSession) -> Dashboard:
    """落一个项目和一张空大屏。Args: session。"""
    project = DashboardProject(name=f"项目{uuid.uuid4().hex}")
    session.add(project)
    await session.flush()
    dashboard = Dashboard(project_id=project.id, name="主屏")
    session.add(dashboard)
    await session.flush()
    return dashboard


async def seed_node(
    session: AsyncSession,
    dashboard: Dashboard,
    *,
    module_type: str = "twin-view",
    client_key: str | None = None,
    parent_id: uuid.UUID | None = None,
) -> DashboardNode:
    """落一个节点。

    Args: session, dashboard, module_type, client_key, parent_id。
    """
    node = DashboardNode(
        id=uuid.uuid4(),
        dashboard_id=dashboard.id,
        parent_id=parent_id,
        client_key=client_key,
        module_type=module_type,
        x_px=0,
        y_px=0,
        width_px=100,
        height_px=100,
    )
    session.add(node)
    await session.flush()
    return node


async def seed_binding(
    session: AsyncSession, node: DashboardNode, *, index: int = 0
) -> DashboardBinding:
    """落一条静态绑定，槽位是 `anchorValues[index].value`。

    Args: session, node, index。
    """
    binding = DashboardBinding(
        id=uuid.uuid4(),
        node_id=node.id,
        field_key=f"anchorValues[{index}].value",
        source_kind="static",
        static_value_json=1,
    )
    session.add(binding)
    await session.flush()
    return binding
