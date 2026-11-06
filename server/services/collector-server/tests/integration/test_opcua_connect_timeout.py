"""建连超时后，真实 asyncua 客户端留下的连接、后台任务与服务端会话都要回收。"""

import asyncio
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from asyncua import Client

from collector_server.apps.collect.drivers.base import (
    DriverConnection,
    DriverTimeouts,
)
from collector_server.apps.collect.drivers.opcua.driver import OpcuaDriver

# 足够让卡住的 activate 之前的握手走完；超时必然落在 create_session 之后
ACTIVATE_DEADLINE_S = 1.0
# 整个用例的上限，只在回收卡死时才会用到
PROBE_DEADLINE_S = 10.0
# 回收预算：留够一次本机往返
TEARDOWN_BUDGET_S = 2.0
CLOSE_SESSION_SEEN = "close-session-seen"

# 独立进程避免协议库标准地址空间初始化受父进程分支覆盖追踪影响。
SERVER_SOURCE = f"""
import asyncio
import signal
import sys
from asyncua import Server, ua
from asyncua.server.uaprocessor import UaProcessor

original = UaProcessor._process_message
close_session = ua.NodeId(
    ua.ObjectIds.CloseSessionRequest_Encoding_DefaultBinary
)

async def reporting(self, typeid, requesthdr, seqhdr, body):
    if typeid == close_session:
        print({CLOSE_SESSION_SEEN!r}, flush=True)
    return await original(self, typeid, requesthdr, seqhdr, body)

UaProcessor._process_message = reporting

async def main():
    server = Server()
    await server.init()
    server.set_endpoint(sys.argv[1])
    stopped = asyncio.Event()
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, stopped.set)
    async with server:
        print('ready', flush=True)
        await stopped.wait()

asyncio.run(main())
"""


class StuckActivation(Client):
    """卡在 activate 的客户端：握手与建会话都是真的，此时后台任务已起。"""

    async def activate_session(
        self, *_args: object, **_kwargs: object
    ) -> object:
        await asyncio.Event().wait()


def _driver(
    endpoint: str, built: list[Client], *, connect_s: float, request_s: float
) -> OpcuaDriver:
    """造一个卡在 activate 的驱动。

    Args: endpoint, built, connect_s, request_s。
    """

    def factory(connection: DriverConnection) -> Client:
        client = StuckActivation(
            url=connection.endpoint, timeout=connection.timeouts.request_s
        )
        built.append(client)
        return client

    return OpcuaDriver(
        connection=DriverConnection(
            endpoint=endpoint,
            timeouts=DriverTimeouts(connect_s=connect_s, request_s=request_s),
        ),
        client_factory=factory,
    )


@asynccontextmanager
async def _server(
    endpoint: str,
) -> AsyncIterator[asyncio.subprocess.Process]:
    """起一个真实 asyncua 服务端子进程。Args: endpoint。"""
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        SERVER_SOURCE,
        endpoint,
        # ⚠ 第三方服务器夹具不继承覆盖追踪；真实驱动仍在父进程收集分支覆盖。
        env={
            name: value
            for name, value in os.environ.items()
            if not name.startswith(("COVERAGE_", "COV_CORE_"))
        },
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        assert process.stdout is not None
        await asyncio.wait_for(process.stdout.readline(), PROBE_DEADLINE_S)
        yield process
    finally:
        process.terminate()
        await process.communicate()


async def test_a_timeout_after_create_session_stops_the_background_tasks(
    unused_tcp_port: int,
) -> None:
    endpoint = f"opc.tcp://127.0.0.1:{unused_tcp_port}/connect-timeout"
    built: list[Client] = []
    made = _driver(
        endpoint,
        built,
        connect_s=ACTIVATE_DEADLINE_S,
        request_s=TEARDOWN_BUDGET_S,
    )
    async with _server(endpoint):
        with pytest.raises(TimeoutError):
            await made.connect()
        client = built[0]
        tasks = (client._renew_channel_task, client._monitor_server_task)
        assert all(task is not None and task.done() for task in tasks)


async def test_a_timeout_after_create_session_tells_the_server_to_close_it(
    unused_tcp_port: int,
) -> None:
    endpoint = f"opc.tcp://127.0.0.1:{unused_tcp_port}/connect-timeout"
    made = _driver(
        endpoint,
        [],
        connect_s=ACTIVATE_DEADLINE_S,
        request_s=TEARDOWN_BUDGET_S,
    )
    async with _server(endpoint) as process:
        with pytest.raises(TimeoutError):
            await made.connect()
        assert process.stdout is not None
        line = await asyncio.wait_for(process.stdout.readline(), 1.0)
    assert line.decode().strip() == CLOSE_SESSION_SEEN


async def test_a_silent_listener_gets_its_socket_back_at_once(
    unused_tcp_port: int,
) -> None:
    has_seen_eof = asyncio.Event()

    async def swallow(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        await reader.read()
        has_seen_eof.set()
        writer.close()

    listener = await asyncio.start_server(swallow, "127.0.0.1", unused_tcp_port)
    made = _driver(
        f"opc.tcp://127.0.0.1:{unused_tcp_port}/silent",
        [],
        connect_s=0.05,
        request_s=PROBE_DEADLINE_S * 3,
    )
    async with listener:
        async with asyncio.timeout(PROBE_DEADLINE_S):
            with pytest.raises(TimeoutError):
                await made.connect()
            await has_seen_eof.wait()
