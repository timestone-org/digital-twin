"""部署迁移的顺序、互斥、超时与失败关闭契约。"""

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest
from pydantic import SecretStr, ValidationError
from sqlalchemy.exc import OperationalError

from deploy import migrate


def make_settings(**overrides: object) -> migrate.RunnerSettings:
    values: dict[str, object] = {
        "postgres_host": "database.test",
        "postgres_user": "owner",
        "postgres_password": SecretStr("test-only-password"),
        "postgres_db": "digitaltwin_test",
        "database_wait_timeout_s": 0.05,
        "command_timeout_s": 0.05,
    }
    values.update(overrides)
    return migrate.RunnerSettings.model_validate(values)


def test_default_plan_keeps_seven_independent_chains_and_two_seeds() -> None:
    plan = migrate.build_commands(migrate.SERVICES, Path("/deployment"))
    assert [(item.service, item.argv[1:]) for item in plan] == [
        ("auth-server", ("-m", "alembic", "upgrade", "head")),
        ("auth-server", ("-m", "scripts.seed")),
        ("platform-server", ("-m", "alembic", "upgrade", "head")),
        ("platform-server", ("-m", "scripts.seed")),
        ("opcua-server", ("-m", "alembic", "upgrade", "head")),
        ("collector-server", ("-m", "alembic", "upgrade", "head")),
        ("realtime-hub", ("-m", "alembic", "upgrade", "head")),
        ("ai-assistant", ("-m", "alembic", "upgrade", "head")),
        ("knowledge-server", ("-m", "alembic", "upgrade", "head")),
    ]
    assert plan[0].cwd == Path("/deployment/services/auth-server")
    assert plan[2].cwd == Path("/deployment/services/platform-server")


def test_selected_services_are_deduplicated_and_keep_declared_order() -> None:
    assert migrate.select_services(
        ["knowledge-server", "auth-server", "knowledge-server"]
    ) == ("auth-server", "knowledge-server")


def test_unknown_service_is_rejected_before_execution() -> None:
    with pytest.raises(migrate.DeploymentFailed, match="未知服务"):
        migrate.select_services(["../../credentials"])


def test_child_database_credentials_match_lock_session() -> None:
    settings = make_settings()
    environment = migrate.build_environment(
        "platform-server",
        settings,
        {
            "PLATFORM_POSTGRES_USER": "wrong-runtime-user",
            "PLATFORM_POSTGRES_HOST": "wrong-database.test",
            "AUTH_EDGE_SIGNING_SECRET": "test-edge-signing",
            "AUTH_EDGE_SERVICE_KEY": "test-service-key",
            "REDIS_HOST": "redis.test",
            "ACSOURCE_HOST": "ems.test",
            "ACSOURCE_DB": "ems",
            "OSS_ENDPOINT": "http://objects.test",
            "COLLECT_CREDENTIAL_SECRET": "test-credential-key",
            "KNOWLEDGE_MODEL_API_KEY": "other-service-secret",
        },
    )
    assert environment["PLATFORM_POSTGRES_HOST"] == "database.test"
    assert environment["PLATFORM_POSTGRES_USER"] == "owner"
    assert environment["PLATFORM_POSTGRES_PASSWORD"] == "test-only-password"
    assert environment["PLATFORM_EDGE_SIGNING_SECRET"] == "test-edge-signing"
    assert environment["PLATFORM_SQLSERVER_DATABASE"] == "ems"
    assert environment["PLATFORM_OBJECTSTORE_ENDPOINT"] == "http://objects.test"
    assert "KNOWLEDGE_MODEL_API_KEY" not in environment


def test_blank_optional_llm_key_is_not_given_to_platform_settings() -> None:
    environment = migrate.build_environment(
        "platform-server", make_settings(), {"LLM_PROVIDER_SECRET": ""}
    )
    assert "PLATFORM_LLM_PROVIDER_SECRET" not in environment


@pytest.mark.asyncio
async def test_migration_failure_stops_before_seed_and_later_services(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    process = AsyncMock(return_value=2)
    connection = AsyncMock()
    monkeypatch.setattr(migrate, "run_command", process)
    commands = migrate.build_commands(
        ("auth-server", "platform-server"), Path("/deployment")
    )
    with pytest.raises(migrate.DeploymentFailed, match="auth-server"):
        await migrate.run_commands(commands, make_settings(), connection)
    assert process.await_count == 1


@pytest.mark.asyncio
async def test_success_runs_seeds_after_their_own_migrations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    process = AsyncMock(return_value=0)
    monkeypatch.setattr(migrate, "run_command", process)
    commands = migrate.build_commands(("auth-server",), Path("/deployment"))
    await migrate.run_commands(commands, make_settings(), AsyncMock())
    assert [call.args[0].argv[1:] for call in process.await_args_list] == [
        ("-m", "alembic", "upgrade", "head"),
        ("-m", "scripts.seed"),
    ]


@pytest.mark.asyncio
async def test_concurrent_deployment_is_rejected_without_running_commands(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = AsyncMock()
    connection.scalar.return_value = False
    process = AsyncMock()
    monkeypatch.setattr(migrate, "run_commands", process)
    with pytest.raises(migrate.DeploymentFailed, match="其他迁移作业"):
        await migrate.run_locked((), make_settings(), connection)
    process.assert_not_awaited()


@pytest.mark.asyncio
async def test_session_lock_is_released_after_failed_command(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = AsyncMock()
    connection.scalar.return_value = True
    monkeypatch.setattr(
        migrate,
        "run_commands",
        AsyncMock(side_effect=migrate.DeploymentFailed("test failure")),
    )
    with pytest.raises(migrate.DeploymentFailed, match="test failure"):
        await migrate.run_locked((), make_settings(), connection)
    assert "pg_advisory_unlock" in str(
        connection.scalar.await_args_list[-1].args[0]
    )


@pytest.mark.asyncio
async def test_database_readiness_checks_authenticated_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = AsyncMock()
    engine = AsyncMock()
    engine.connect = AsyncMock(return_value=connection)
    monkeypatch.setattr(
        migrate, "create_async_engine", lambda *_a, **_k: engine
    )
    async with migrate.connect_database(make_settings()) as actual:
        assert actual is connection
        assert "SELECT 1" in str(connection.execute.await_args.args[0])
    connection.close.assert_awaited_once()
    engine.dispose.assert_awaited_once()


@pytest.mark.asyncio
async def test_database_wait_is_bounded_and_does_not_expose_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = AsyncMock()
    engine.connect = AsyncMock(
        side_effect=OperationalError(
            "test", {}, RuntimeError("test-only-password")
        )
    )
    monkeypatch.setattr(
        migrate, "create_async_engine", lambda *_a, **_k: engine
    )
    with pytest.raises(migrate.DeploymentFailed, match="数据库未就绪") as error:
        async with migrate.connect_database(make_settings()):
            pytest.fail("unavailable database must not run migrations")
    assert "test-only-password" not in str(error.value)
    engine.dispose.assert_awaited_once()


@pytest.mark.asyncio
async def test_command_timeout_terminates_the_child(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    process = AsyncMock()
    process.returncode = None
    process.terminate = lambda: None
    process.kill = lambda: None
    started = asyncio.Event()

    async def wait() -> int:
        started.set()
        await asyncio.Event().wait()
        return 0

    process.wait.side_effect = wait
    stop = AsyncMock()
    monkeypatch.setattr(
        migrate.asyncio,
        "create_subprocess_exec",
        AsyncMock(return_value=process),
    )
    monkeypatch.setattr(migrate, "stop_process", stop)
    command = migrate.build_commands(("auth-server",), Path("/deployment"))[0]
    with pytest.raises(migrate.DeploymentFailed, match="超时"):
        await migrate.run_command(command, make_settings(), AsyncMock())
    assert started.is_set()
    stop.assert_awaited_once()


@pytest.mark.asyncio
async def test_lost_lock_connection_stops_running_child(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    process = AsyncMock()
    process.returncode = None

    async def wait() -> int:
        await asyncio.Event().wait()
        return 0

    process.wait.side_effect = wait
    connection = AsyncMock()
    connection.execute.side_effect = OperationalError(
        "test", {}, RuntimeError()
    )
    stop = AsyncMock()
    monkeypatch.setattr(
        migrate.asyncio,
        "create_subprocess_exec",
        AsyncMock(return_value=process),
    )
    monkeypatch.setattr(migrate, "stop_process", stop)
    command = migrate.build_commands(("auth-server",), Path("/deployment"))[0]
    with pytest.raises(migrate.DeploymentFailed, match="迁移锁连接已丢失"):
        await migrate.run_command(
            command, make_settings(command_timeout_s=2), connection
        )
    stop.assert_awaited_once()


@pytest.mark.asyncio
async def test_cancelled_command_stops_child_before_returning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    process = AsyncMock()
    process.returncode = None
    started = asyncio.Event()

    async def wait() -> int:
        started.set()
        await asyncio.Event().wait()
        return 0

    process.wait.side_effect = wait
    stop = AsyncMock()
    monkeypatch.setattr(
        migrate.asyncio,
        "create_subprocess_exec",
        AsyncMock(return_value=process),
    )
    monkeypatch.setattr(migrate, "stop_process", stop)
    command = migrate.build_commands(("auth-server",), Path("/deployment"))[0]
    task = asyncio.create_task(
        migrate.run_command(
            command, make_settings(command_timeout_s=2), AsyncMock()
        )
    )
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    stop.assert_awaited_once()


@pytest.mark.parametrize(
    "field", ["database_wait_timeout_s", "command_timeout_s"]
)
def test_zero_timeout_is_rejected(field: str) -> None:
    with pytest.raises(ValidationError):
        make_settings(**{field: 0})


@pytest.mark.asyncio
async def test_invalidated_lock_session_cannot_reconnect_and_continue() -> None:
    connection = AsyncMock()
    connection.invalidated = True
    with pytest.raises(migrate.DeploymentFailed, match="迁移锁连接已丢失"):
        await migrate.check_connection(connection)
    connection.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_process_ignoring_termination_is_killed() -> None:
    process = AsyncMock()
    process.returncode = None
    process.terminate = Mock()
    process.kill = Mock()
    process.wait.side_effect = [TimeoutError, 0]
    await migrate.stop_process(process)
    process.terminate.assert_called_once()
    process.kill.assert_called_once()


@pytest.mark.asyncio
async def test_finished_process_is_not_terminated() -> None:
    process = AsyncMock()
    process.returncode = 0
    process.terminate = Mock()
    await migrate.stop_process(process)
    process.terminate.assert_not_called()


@pytest.mark.asyncio
async def test_cancelled_spawn_recovers_and_stops_created_child(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started, release = asyncio.Event(), asyncio.Event()
    process = AsyncMock()

    async def create(*_args: object, **_kwargs: object) -> AsyncMock:
        started.set()
        await release.wait()
        return process

    stop = AsyncMock()
    monkeypatch.setattr(migrate.asyncio, "create_subprocess_exec", create)
    monkeypatch.setattr(migrate, "stop_process", stop)
    command = migrate.build_commands(("auth-server",), Path("/deployment"))[0]
    task = asyncio.create_task(
        migrate.start_process(command, make_settings(), {})
    )
    await started.wait()
    task.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    stop.assert_awaited_once_with(process)


@pytest.mark.asyncio
async def test_readiness_failure_closes_partial_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = AsyncMock()
    connection.execute.side_effect = OperationalError(
        "test", {}, RuntimeError()
    )
    engine = AsyncMock()
    engine.connect = AsyncMock(return_value=connection)
    monkeypatch.setattr(
        migrate, "create_async_engine", lambda *_a, **_k: engine
    )
    with pytest.raises(migrate.DeploymentFailed, match="数据库未就绪"):
        async with migrate.connect_database(make_settings()):
            pytest.fail("failed authenticated query must block migration")
    connection.close.assert_awaited_once()


@pytest.mark.parametrize("return_code", [0, 2], ids=["complete", "failed"])
def test_cli_runs_selected_owner_and_stops_on_failure(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    return_code: int,
) -> None:
    for key, value in (
        ("POSTGRES_HOST", "database.test"),
        ("POSTGRES_USER", "owner"),
        ("POSTGRES_PASSWORD", "test-only-password"),
        ("POSTGRES_DB", "digitaltwin_test"),
        ("MIGRATION_DATABASE_WAIT_TIMEOUT_S", "0.05"),
        ("MIGRATION_COMMAND_TIMEOUT_S", "0.05"),
    ):
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(
        migrate.sys, "argv", ["migrate.py", "--service", "auth-server"]
    )
    connection = AsyncMock()
    connection.scalar.return_value = True
    engine = AsyncMock()
    engine.connect = AsyncMock(return_value=connection)
    process = AsyncMock()
    process.wait.return_value = return_code
    create = AsyncMock(return_value=process)
    monkeypatch.setattr(
        migrate, "create_async_engine", lambda *_a, **_k: engine
    )
    monkeypatch.setattr(migrate.asyncio, "create_subprocess_exec", create)
    if return_code:
        with pytest.raises(SystemExit, match="1"):
            migrate.main()
        assert create.await_count == 1
    else:
        migrate.main()
        assert [call.args[1:] for call in create.await_args_list] == [
            ("-m", "alembic", "upgrade", "head"),
            ("-m", "scripts.seed"),
        ]
    output = capsys.readouterr()
    assert "test-only-password" not in output.out + output.err


@pytest.mark.asyncio
async def test_unavailable_unlock_does_not_replace_original_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = AsyncMock()
    connection.scalar.side_effect = [
        True,
        OperationalError("test", {}, RuntimeError()),
    ]
    monkeypatch.setattr(
        migrate,
        "run_commands",
        AsyncMock(side_effect=migrate.DeploymentFailed("original failure")),
    )
    with pytest.raises(migrate.DeploymentFailed, match="original failure"):
        await migrate.run_locked((), make_settings(), connection)
