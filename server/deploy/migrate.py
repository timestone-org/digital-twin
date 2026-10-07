"""部署作业按属主顺序执行迁移与种子，设计见 docker/README.md。"""

from __future__ import annotations

import argparse
import asyncio
import os
import signal
import socket
import sys
from collections.abc import AsyncGenerator, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import SettingsConfigDict
from sqlalchemy import URL, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from sqlalchemy.pool import NullPool

from lib.config import EnvSettings, load_settings_or_exit
from lib.logging import configure_logging, get_logger

SERVICES: tuple[str, ...] = (
    "auth-server",
    "platform-server",
    "opcua-server",
    "collector-server",
    "realtime-hub",
    "ai-assistant",
    "knowledge-server",
)
SERVICE_PREFIXES: tuple[tuple[str, str], ...] = (
    ("auth-server", "AUTH"),
    ("platform-server", "PLATFORM"),
    ("opcua-server", "OPCUA"),
    ("collector-server", "COLLECT"),
    ("realtime-hub", "REALTIME"),
    ("ai-assistant", "ASSISTANT"),
    ("knowledge-server", "KNOWLEDGE"),
)
PLATFORM_ALIASES: tuple[tuple[str, str], ...] = (
    ("AUTH_EDGE_SIGNING_SECRET", "PLATFORM_EDGE_SIGNING_SECRET"),
    ("AUTH_EDGE_SERVICE_KEY", "PLATFORM_EDGE_SERVICE_KEY"),
    ("COLLECT_CREDENTIAL_SECRET", "PLATFORM_COLLECT_CREDENTIAL_SECRET"),
    ("LLM_PROVIDER_SECRET", "PLATFORM_LLM_PROVIDER_SECRET"),
    ("OSS_ENDPOINT", "PLATFORM_OBJECTSTORE_ENDPOINT"),
    ("OSS_BUCKET", "PLATFORM_OBJECTSTORE_BUCKET"),
    ("OSS_ACCESS_KEY", "PLATFORM_OBJECTSTORE_ACCESS_KEY"),
    ("OSS_SECRET_KEY", "PLATFORM_OBJECTSTORE_SECRET_KEY"),
    ("OSS_PUBLIC_BASE", "PLATFORM_OBJECTSTORE_PUBLIC_BASE"),
    ("ACSOURCE_HOST", "PLATFORM_SQLSERVER_HOST"),
    ("ACSOURCE_PORT", "PLATFORM_SQLSERVER_PORT"),
    ("ACSOURCE_USER", "PLATFORM_SQLSERVER_USER"),
    ("ACSOURCE_PASSWORD", "PLATFORM_SQLSERVER_PASSWORD"),
    ("ACSOURCE_DB", "PLATFORM_SQLSERVER_DATABASE"),
)
PROCESS_ENVIRONMENT: tuple[str, ...] = (
    "PATH",
    "PYTHONPATH",
    "PYTHONUNBUFFERED",
    "PYTHONDONTWRITEBYTECODE",
    "LANG",
    "LC_ALL",
    "HOME",
)
LOCK_NAMESPACE: int = 114637
LOCK_RESOURCE: int = 1
DATABASE_CALL_TIMEOUT_S: float = 5.0
LOCK_CHECK_INTERVAL_S: float = 1.0
PROCESS_STOP_TIMEOUT_S: float = 5.0
_logger = get_logger("deployment.migrate")


class DeploymentFailed(RuntimeError):
    """部署前置条件或属主命令失败。"""


class RunnerSettings(EnvSettings):
    """迁移连接与执行预算。"""

    model_config = SettingsConfigDict(
        extra="ignore", frozen=True, populate_by_name=True
    )
    postgres_host: str = Field(min_length=1)
    postgres_port: int = Field(default=5432, gt=0, le=65535)
    postgres_user: str = Field(min_length=1)
    postgres_password: SecretStr = Field(min_length=1)
    postgres_db: str = Field(min_length=1)
    database_wait_timeout_s: float = Field(
        default=120.0,
        gt=0,
        allow_inf_nan=False,
        validation_alias="MIGRATION_DATABASE_WAIT_TIMEOUT_S",
    )
    command_timeout_s: float = Field(
        default=600.0,
        gt=0,
        allow_inf_nan=False,
        validation_alias="MIGRATION_COMMAND_TIMEOUT_S",
    )

    def database_url(self) -> URL:
        """构建数据库连接 URL。
        Returns: URL
        """
        return URL.create(
            "postgresql+asyncpg",
            username=self.postgres_user,
            password=self.postgres_password.get_secret_value(),
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
        )


@dataclass(frozen=True)
class Command:
    """一个服务目录下的独立进程命令。"""

    service: str
    argv: tuple[str, ...]
    cwd: Path


def select_services(requested: Sequence[str] | None) -> tuple[str, ...]:
    """验证并按固定顺序选择属主。Args: requested。"""
    if not requested:
        return SERVICES
    unknown = set(requested) - set(SERVICES)
    if unknown:
        raise DeploymentFailed(f"未知服务：{', '.join(sorted(unknown))}")
    return tuple(service for service in SERVICES if service in requested)


def build_commands(services: Sequence[str], root: Path) -> tuple[Command, ...]:
    """为属主组装迁移与种子命令。Args: services, root。"""
    commands: list[Command] = []
    for service in services:
        directory = root / "services" / service
        commands.append(
            Command(
                service,
                (sys.executable, "-m", "alembic", "upgrade", "head"),
                directory,
            )
        )
        if service in ("auth-server", "platform-server"):
            commands.append(
                Command(
                    service,
                    (sys.executable, "-m", "scripts.seed"),
                    directory,
                )
            )
    return tuple(commands)


def build_environment(
    service: str, settings: RunnerSettings, source: Mapping[str, str]
) -> dict[str, str]:
    """只向属主传递所需配置并统一迁移账号。Args: service, settings, source。"""
    prefix = dict(SERVICE_PREFIXES)[service]
    environment = {
        name: value
        for name, value in source.items()
        if name.startswith(f"{prefix}_") or name in PROCESS_ENVIRONMENT
    }
    for name, value in (
        ("HOST", settings.postgres_host),
        ("PORT", str(settings.postgres_port)),
        ("USER", settings.postgres_user),
        ("PASSWORD", settings.postgres_password.get_secret_value()),
        ("DB", settings.postgres_db),
    ):
        environment[f"{prefix}_POSTGRES_{name}"] = value
    if service in ("auth-server", "platform-server"):
        for name in ("HOST", "PORT", "PASSWORD", "DB", "TIMEOUT_S"):
            value = source.get(f"REDIS_{name}")
            if value is not None:
                environment.setdefault(f"{prefix}_REDIS_{name}", value)
    if service == "platform-server":
        for name, target in PLATFORM_ALIASES:
            value = source.get(name)
            if value:
                environment.setdefault(target, value)
        if not environment.get("PLATFORM_LLM_PROVIDER_SECRET"):
            environment.pop("PLATFORM_LLM_PROVIDER_SECRET", None)
    return environment


async def close_connection(connection: AsyncConnection) -> None:
    """有界关闭会话。Args: connection。"""
    try:
        await asyncio.wait_for(connection.close(), DATABASE_CALL_TIMEOUT_S)
    except (SQLAlchemyError, OSError, TimeoutError):
        _logger.warning("migration_connection_close_failed", "关闭迁移会话失败")


@asynccontextmanager
async def connect_database(
    settings: RunnerSettings,
) -> AsyncGenerator[AsyncConnection]:
    """等待真实认证与查询成功，超出预算即退出。Args: settings。"""
    engine = create_async_engine(
        settings.database_url(),
        poolclass=NullPool,
        hide_parameters=True,
        connect_args={
            "timeout": DATABASE_CALL_TIMEOUT_S,
            "command_timeout": DATABASE_CALL_TIMEOUT_S,
        },
    )
    connection: AsyncConnection | None = None
    deadline = (
        asyncio.get_running_loop().time() + settings.database_wait_timeout_s
    )
    try:
        while asyncio.get_running_loop().time() < deadline:
            remaining = deadline - asyncio.get_running_loop().time()
            try:
                async with asyncio.timeout(remaining):
                    connection = await engine.connect()
                    await connection.execute(text("SELECT 1"))
                    await connection.commit()
                break
            except (SQLAlchemyError, OSError, TimeoutError):
                if connection is not None:
                    await close_connection(connection)
                    connection = None
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining > 0:
                    await asyncio.sleep(min(1.0, remaining))
        if connection is None:
            raise DeploymentFailed("数据库未就绪，迁移等待已超时")
        yield connection
    finally:
        if connection is not None:
            await close_connection(connection)
        await asyncio.wait_for(engine.dispose(), DATABASE_CALL_TIMEOUT_S)


async def check_connection(connection: AsyncConnection) -> None:
    """丢失持锁会话时关闭执行路径。Args: connection。"""
    if connection.closed is True or connection.invalidated is True:
        raise DeploymentFailed("迁移锁连接已丢失，已停止执行")
    try:
        async with asyncio.timeout(DATABASE_CALL_TIMEOUT_S):
            await connection.execute(text("SELECT 1"))
            await connection.commit()
    except (SQLAlchemyError, OSError, TimeoutError) as error:
        raise DeploymentFailed("迁移锁连接已丢失，已停止执行") from error


async def stop_process(process: asyncio.subprocess.Process) -> None:
    """先终止、超时再杀死子进程。Args: process。"""
    if process.returncode is not None:
        return
    try:
        process.terminate()
    except ProcessLookupError:
        return
    try:
        await asyncio.wait_for(process.wait(), PROCESS_STOP_TIMEOUT_S)
    except TimeoutError:
        try:
            process.kill()
        except ProcessLookupError:
            return
        await asyncio.wait_for(process.wait(), PROCESS_STOP_TIMEOUT_S)


async def start_process(
    command: Command, settings: RunnerSettings, source: Mapping[str, str]
) -> asyncio.subprocess.Process:
    """保留创建任务以在取消时收回已启动子进程。

    Args: command, settings, source。
    """
    spawning = asyncio.create_task(
        asyncio.create_subprocess_exec(
            *command.argv,
            cwd=command.cwd,
            env=build_environment(command.service, settings, source),
        )
    )
    try:
        return await asyncio.shield(spawning)
    except asyncio.CancelledError:
        process = await spawning
        await stop_process(process)
        raise


async def run_command(
    command: Command,
    settings: RunnerSettings,
    connection: AsyncConnection,
    environment: Mapping[str, str] | None = None,
) -> int:
    """执行命令并在超时、取消或丢锁时终止进程。

    Args: command, settings, connection, environment。
    """
    source = os.environ if environment is None else environment
    process = await start_process(command, settings, source)
    waiting = asyncio.create_task(process.wait())
    try:
        async with asyncio.timeout(settings.command_timeout_s):
            while not waiting.done():
                await asyncio.wait({waiting}, timeout=LOCK_CHECK_INTERVAL_S)
                await check_connection(connection)
            return waiting.result()
    except TimeoutError as error:
        await stop_process(process)
        raise DeploymentFailed(
            f"{command.service} 迁移命令超时，已停止"
        ) from error
    except (DeploymentFailed, asyncio.CancelledError):
        await stop_process(process)
        raise
    finally:
        if not waiting.done():
            waiting.cancel()
        await asyncio.gather(waiting, return_exceptions=True)


async def run_commands(
    commands: Sequence[Command],
    settings: RunnerSettings,
    connection: AsyncConnection,
    environment: Mapping[str, str] | None = None,
) -> None:
    """任一属主命令失败即阻断余下计划。

    Args: commands, settings, connection, environment。
    """
    for command in commands:
        await check_connection(connection)
        _logger.info(
            "migration_command_started",
            "执行属主命令",
            service=command.service,
            command=" ".join(command.argv[1:]),
        )
        result = await run_command(command, settings, connection, environment)
        if result != 0:
            raise DeploymentFailed(
                f"{command.service} 命令失败，退出码 {result}"
            )


async def run_locked(
    commands: Sequence[Command],
    settings: RunnerSettings,
    connection: AsyncConnection,
    environment: Mapping[str, str] | None = None,
) -> None:
    """拒绝并发部署并在整个计划期间持有会话锁。

    Args: commands, settings, connection, environment。
    """
    parameters = {"namespace": LOCK_NAMESPACE, "resource": LOCK_RESOURCE}
    acquired = await asyncio.wait_for(
        connection.scalar(
            text("SELECT pg_try_advisory_lock(:namespace, :resource)"),
            parameters,
        ),
        DATABASE_CALL_TIMEOUT_S,
    )
    if acquired is not True:
        raise DeploymentFailed("其他迁移作业正在执行，本次部署已拒绝")
    try:
        # ⚠ 会话锁跨提交保留，不能改成事务锁，否则第一条提交后互斥就失效。
        await asyncio.wait_for(connection.commit(), DATABASE_CALL_TIMEOUT_S)
        await run_commands(commands, settings, connection, environment)
    finally:
        try:
            await asyncio.wait_for(
                connection.scalar(
                    text("SELECT pg_advisory_unlock(:namespace, :resource)"),
                    parameters,
                ),
                DATABASE_CALL_TIMEOUT_S,
            )
            await asyncio.wait_for(connection.commit(), DATABASE_CALL_TIMEOUT_S)
        except (SQLAlchemyError, OSError, TimeoutError):
            _logger.warning(
                "migration_lock_release_failed", "迁移会话结束时释放锁失败"
            )


async def execute(
    services: Sequence[str],
    settings: RunnerSettings,
    environment: Mapping[str, str],
    root: Path,
) -> None:
    """在持锁连接上完成部署计划。

    Args: services, settings, environment, root。
    """
    task = asyncio.current_task()
    loop = asyncio.get_running_loop()
    if task is not None:
        loop.add_signal_handler(signal.SIGTERM, task.cancel)
    try:
        commands = build_commands(services, root)
        async with connect_database(settings) as connection:
            await run_locked(commands, settings, connection, environment)
        _logger.info("migration_completed", "部署迁移与种子已完成")
    finally:
        loop.remove_signal_handler(signal.SIGTERM)


def main() -> None:
    """部署迁移的命令行入口。"""
    parser = argparse.ArgumentParser(description="执行服务属主迁移与种子")
    parser.add_argument("--service", action="append", choices=SERVICES)
    arguments = parser.parse_args()
    settings = load_settings_or_exit(RunnerSettings)
    configure_logging(
        service="database-migrate",
        role="migration",
        instance=socket.gethostname(),
        level="INFO",
        log_format="json",
    )
    try:
        asyncio.run(
            execute(
                select_services(arguments.service),
                settings,
                dict(os.environ),
                Path(__file__).resolve().parent.parent,
            )
        )
    except (
        DeploymentFailed,
        asyncio.CancelledError,
        SQLAlchemyError,
        OSError,
        TimeoutError,
    ) as error:
        message = (
            str(error)
            if isinstance(error, DeploymentFailed)
            else "迁移已中止或前置调用失败"
        )
        _logger.error("migration_failed", message)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
