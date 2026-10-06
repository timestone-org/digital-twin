"""启动自检不绕过 HTTP 和 PLC 驱动的出站授权。"""

import asyncio
from dataclasses import dataclass
from typing import cast

import pytest

from collector_server.app import _probe_plant
from collector_server.container import Container
from collector_server.settings import Settings
from collectwire import CollectPlan, PlanSource


@dataclass(frozen=True)
class ProbePlan:
    current: CollectPlan | None


@dataclass(frozen=True)
class ProbeContainer:
    plan: ProbePlan
    settings: Settings


def _source(protocol: str) -> PlanSource:
    endpoint = {
        "http": "http://127.0.0.1:18080/data",
        "modbus_tcp": "modbus.tcp://127.0.0.1:502",
        "opcua": "opc.tcp://127.0.0.1:4840",
    }[protocol]
    return PlanSource(
        source_id="0192f000-0000-7000-8000-000000000001",
        code=protocol,
        protocol=protocol,
        endpoint=endpoint,
    )


def _container(
    settings: Settings, sources: tuple[PlanSource, ...]
) -> Container:
    # 自检只消费计划和配置，替身不创建真实数据库或 Redis 连接。
    return cast(
        Container,
        ProbeContainer(
            ProbePlan(CollectPlan(version="startup", sources=sources)), settings
        ),
    )


@pytest.mark.parametrize("protocol", ["http", "modbus_tcp"])
@pytest.mark.parametrize("is_enabled", [False, True])
async def test_http_and_plc_startup_do_not_bypass_driver_network_policy(
    protocol: str,
    is_enabled: bool,
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, int]] = []

    async def connect(host: str, port: int) -> None:
        calls.append((host, port))
        raise OSError("受控探针")

    monkeypatch.setattr(asyncio, "open_connection", connect)
    configured = settings.model_copy(
        update={"http_read_enabled": is_enabled, "plc_read_enabled": is_enabled}
    )
    await _probe_plant(_container(configured, (_source(protocol),)))
    assert calls == []


async def test_startup_tcp_probe_is_only_used_for_the_existing_opcua_source(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[tuple[str, int]] = []

    async def connect(host: str, port: int) -> None:
        calls.append((host, port))
        raise OSError("受控探针")

    monkeypatch.setattr(asyncio, "open_connection", connect)
    await _probe_plant(
        _container(
            settings, (_source("http"), _source("modbus_tcp"), _source("opcua"))
        )
    )
    assert calls == [("127.0.0.1", 4840)]
