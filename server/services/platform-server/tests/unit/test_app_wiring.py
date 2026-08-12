"""装配契约：外库进关停序列与启动自检，但**绝不进就绪判定**。

⚠ 把外库塞进 readiness 会让厂商库抖一下就摘掉整个副本的流量，连台账页与空间
配置页一起挂掉——而那两页根本不读外库。理由见 docs/adr/0006。
"""

from dataclasses import dataclass, field
from typing import cast

from pydantic import SecretStr

from lib.db import Database, ReadOnlySqlSource
from platform_server.app import _hooks, _probes, _selfcheck
from platform_server.apps.hvac.deps import get_ac_source_reader
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.container import Container
from platform_server.settings import Settings

PLACEHOLDER = "wiring-test"


@dataclass
class FakeDependency:
    """只回答「通不通」并记下自己有没有被关掉。"""

    is_reachable: bool = True
    closed: list[str] = field(default_factory=list)

    async def ping(self) -> bool:
        return self.is_reachable

    async def dispose(self) -> None:
        self.closed.append("once")


def build_settings() -> Settings:
    """一份能构造出来的配置，不连任何依赖。"""
    return Settings(
        postgres_host=PLACEHOLDER,
        postgres_user=PLACEHOLDER,
        postgres_password=SecretStr(PLACEHOLDER),
        postgres_db=PLACEHOLDER,
        sqlserver_host=PLACEHOLDER,
        sqlserver_user=PLACEHOLDER,
        sqlserver_password=SecretStr(PLACEHOLDER),
        sqlserver_database=PLACEHOLDER,
        edge_signing_secret=SecretStr("x" * 32),
    )


def build_container(
    *, is_database_up: bool = True, is_source_up: bool = True
) -> tuple[Container, FakeDependency, FakeDependency]:
    """一个装着假依赖的组合根。

    Args: is_database_up, is_source_up。
    """
    database = FakeDependency(is_reachable=is_database_up)
    source = FakeDependency(is_reachable=is_source_up)
    # cast 的理由：这两件只需要满足 ping/dispose，容器本身不做类型校验
    container = Container(
        settings=build_settings(),
        database=cast(Database, database),
        ac_source=cast(ReadOnlySqlSource, source),
    )
    return container, database, source


def test_readiness_never_waits_on_the_external_source() -> None:
    container, _database, _source = build_container()
    assert [probe.name for probe in _probes(container)] == ["postgres"]


def test_the_external_source_is_closed_before_the_connection_pool() -> None:
    # 连接池最后关：在途请求还要用它
    container, _database, _source = build_container()
    closing = [
        hook.name
        for hook in sorted(
            _hooks(container), key=lambda item: item.shutdown_order
        )
        if hook.shutdown is not None
    ]
    assert closing == ["ac_source", "database"]


async def assert_selfcheck_survives(
    *, is_database_up: bool, is_source_up: bool
) -> None:
    """启动自检的契约就是「只记录、不抛」。

    Args: is_database_up, is_source_up。
    """
    container, _database, _source = build_container(
        is_database_up=is_database_up, is_source_up=is_source_up
    )
    await _selfcheck(container)


async def test_an_unreachable_source_does_not_block_startup() -> None:
    # 外库挂了不该让进程起不来，它只让空调数据面返回 503
    await assert_selfcheck_survives(is_database_up=True, is_source_up=False)


async def test_an_unreachable_database_does_not_block_startup_either() -> None:
    # 数据库不可达由就绪探针拦，不由启动流程拦
    await assert_selfcheck_survives(is_database_up=False, is_source_up=True)


async def test_a_healthy_startup_checks_both_dependencies() -> None:
    await assert_selfcheck_survives(is_database_up=True, is_source_up=True)


def test_the_reader_dependency_takes_its_timezone_from_config() -> None:
    container, _database, _source = build_container()
    assert isinstance(get_ac_source_reader(container), AcSourceReader)
