"""启动自检的两条分支。

⚠ 自检**不阻断启动**——依赖抖一下就拒绝起进程会把一次网络毛刺放大成停服。
它的职责是把「依赖不通」响亮地写进日志，就绪探针再据实拒绝流量。
"""

from types import SimpleNamespace
from typing import cast

from pydantic import SecretStr

from opcua_server.app import _selfcheck
from opcua_server.container import Container
from opcua_server.settings import Settings

SECRET = SecretStr("x" * 32)


def _settings() -> Settings:
    return Settings(
        postgres_host="h",
        postgres_user="u",
        postgres_password=SecretStr("p"),
        postgres_db="d",
        redis_host="r",
        edge_signing_secret=SECRET,
        edge_service_key=SECRET,
    )


def _container(
    *, is_database_ok: bool, is_cache_ok: bool, probed: list[str]
) -> Container:
    """只带自检要用到的三样东西的容器替身。

    Args: is_database_ok, is_cache_ok, probed（记录被探了哪几项）。
    """

    async def _database_ping() -> bool:
        probed.append("postgres")
        return is_database_ok

    async def _cache_ping() -> bool:
        probed.append("redis")
        return is_cache_ok

    return cast(
        Container,
        SimpleNamespace(
            settings=_settings(),
            database=SimpleNamespace(ping=_database_ping),
            cache=SimpleNamespace(ping=_cache_ping),
        ),
    )


async def test_selfcheck_probes_every_dependency() -> None:
    """自检真的把每个依赖都探了一遍，而不是只看配置。"""
    probed: list[str] = []
    await _selfcheck(
        _container(is_database_ok=True, is_cache_ok=True, probed=probed)
    )
    assert probed == ["postgres", "redis"]


async def test_selfcheck_does_not_raise_when_database_is_down() -> None:
    """数据库不通时不抛异常，只记错误——进程照起，就绪探针负责拒流量。

    ⚠ 依赖抖一下就拒绝起进程，会把一次网络毛刺放大成停服。
    """
    probed: list[str] = []
    await _selfcheck(
        _container(is_database_ok=False, is_cache_ok=True, probed=probed)
    )
    assert probed == ["postgres", "redis"]


async def test_selfcheck_does_not_raise_when_cache_is_down() -> None:
    """缓存不通时同样不阻断启动。"""
    probed: list[str] = []
    await _selfcheck(
        _container(is_database_ok=True, is_cache_ok=False, probed=probed)
    )
    assert probed == ["postgres", "redis"]
