"""alembic 运行环境。

迁移链绑定 `opcua` schema 并把版本表也放在里面——每个服务只操作自己的 schema，
迁移里出现别的 schema 名即为写权限越界。
"""

import asyncio

from alembic import context
from sqlalchemy import Connection, pool, text
from sqlalchemy.ext.asyncio import async_engine_from_config

from lib.config import load_settings_or_exit
from opcua_server.apps.instance.models import Base
from opcua_server.settings import DB_SCHEMA, Settings

config = context.config
target_metadata = Base.metadata

_settings = load_settings_or_exit(Settings)


def include_object(
    _object: object,
    _name: str | None,
    type_: str,
    _reflected: bool,
    _compare_to: object,
) -> bool:
    """只纳管本服务 schema 内的对象。

    Args: _object, _name, type_, _reflected, _compare_to。
    """
    if type_ == "table":
        schema = getattr(_object, "schema", None)
        return schema in (None, DB_SCHEMA)
    return True


def _configure(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        version_table="alembic_version",
        version_table_schema=DB_SCHEMA,
        include_schemas=True,
        include_object=include_object,
        compare_type=True,
    )


def _run(connection: Connection) -> None:
    connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{DB_SCHEMA}"'))
    _configure(connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_online() -> None:
    """连库执行迁移。"""
    engine = async_engine_from_config(
        {"sqlalchemy.url": _settings.dsn()},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with engine.connect() as connection:
        await connection.run_sync(_run)
        await connection.commit()
    await engine.dispose()


def run_offline() -> None:
    """只生成 SQL，不连库。"""
    context.configure(
        url=_settings.dsn(),
        target_metadata=target_metadata,
        literal_binds=True,
        version_table_schema=DB_SCHEMA,
        include_schemas=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_offline()
else:
    asyncio.run(run_online())
