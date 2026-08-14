"""守工控网自检：端点解析、连不通判否、探不了的不冒充可达。

⚠ 静默退化成一个连不上现场的采集器，是这条链路上最难察觉的故障
（ARCHITECTURE §7）。
"""

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import pytest

from collector_server.apps.collect.runtime.reachability import (
    endpoint_target,
    is_reachable,
    unreachable_codes,
)

# 没有服务在这个端口上：连它一定被拒
CLOSED_PORT = 1


@pytest.mark.parametrize(
    ("endpoint", "expected"),
    [
        ("opc.tcp://10.0.0.9:4840/line-1", ("10.0.0.9", 4840)),
        ("opc.tcp://plc-1:4840", ("plc-1", 4840)),
        ("http://example:8080/api", ("example", 8080)),
        ("opc.tcp://plc-1", None),
        ("", None),
    ],
    ids=["ip", "hostname", "http", "no-port", "empty"],
)
def test_endpoint_target(
    endpoint: str, expected: tuple[str, int] | None
) -> None:
    assert endpoint_target(endpoint) == expected


@pytest.fixture
async def listener() -> AsyncIterator[int]:
    """本机上一个真在监听的端口。"""

    async def handle(
        _reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    async with server:
        yield int(port)


async def test_a_listening_port_is_reachable(listener: int) -> None:
    assert await is_reachable("127.0.0.1", listener, timeout_s=2.0) is True


async def test_a_closed_port_is_not_reachable() -> None:
    assert await is_reachable("127.0.0.1", CLOSED_PORT, timeout_s=2.0) is False


async def test_unreachable_sources_are_named(
    build_source: Any, listener: int
) -> None:
    unreachable = await unreachable_codes(
        [
            build_source(code="up", endpoint=f"opc.tcp://127.0.0.1:{listener}"),
            build_source(
                code="down", endpoint=f"opc.tcp://127.0.0.1:{CLOSED_PORT}"
            ),
        ],
        timeout_s=2.0,
    )
    assert unreachable == ["down"]


async def test_a_source_without_a_port_is_not_probed(build_source: Any) -> None:
    unreachable = await unreachable_codes(
        [build_source(code="mystery", endpoint="opc.tcp://plc-1")],
        timeout_s=2.0,
    )
    assert unreachable == []
