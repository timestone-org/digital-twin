"""正常 HTTP 监听器在停机窗口内公布未就绪并保留在途请求。"""

import asyncio
import signal
import socket
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import APIRouter, FastAPI

from lib.config import HttpAppSettings
from lib.lifespan import LifespanHook, LifespanRunner
from lib.web import ReadinessProbe, Runtime, create_app
from lib.web.server import HttpServer


def app_for(events: dict[str, asyncio.Event], budget: float) -> FastAPI:
    router = APIRouter()

    async def work() -> dict[str, bool]:
        events["work"].set()
        try:
            await events["release"].wait()
            return {"completed": True}
        finally:
            events["leave"].set()

    async def probe() -> bool:
        events["probe"].set()
        await events["probe_release"].wait()
        return True

    async def stopped() -> None:
        events["stop"].set()

    router.add_api_route("/work", work)
    return create_app(
        title="transfer",
        prefix="/probe",
        routers=[router],
        runtime=Runtime(
            readiness_probes=(ReadinessProbe("local", probe),),
            lifespan_hooks=(LifespanHook(name="observer", shutdown=stopped),),
            drain_timeout_s=budget,
        ),
    )


@asynccontextmanager
async def running_server(
    budget: float = 1.0, withdrawal: float = 0.3
) -> AsyncIterator[
    tuple[HttpServer, httpx.AsyncClient, dict[str, asyncio.Event]]
]:
    events = {
        key: asyncio.Event()
        for key in (
            "work",
            "leave",
            "release",
            "stop",
            "probe",
            "probe_release",
        )
    }
    app = app_for(events, budget)
    config = HttpAppSettings(
        app_http_host="127.0.0.1",
        app_http_port=0,
        app_drain_timeout_s=budget,
        app_readiness_withdraw_s=withdrawal,
    )
    server = HttpServer(app, config)
    server.config.load()
    server.lifespan = server.config.lifespan_class(server.config)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        await server.startup(sockets=[listener])
        origin = f"http://127.0.0.1:{listener.getsockname()[1]}"
        async with httpx.AsyncClient(
            base_url=origin, timeout=4, trust_env=False
        ) as client:
            try:
                yield server, client, events
            finally:
                events["probe_release"].set()
                events["release"].set()
                if not server.should_exit:
                    await server.shutdown()


async def test_withdrawal_is_visible_while_an_existing_request_completes() -> (
    None
):
    async with running_server() as (server, client, events):
        events["probe_release"].set()
        assert (await client.get("/probe/ready")).status_code == 200
        pending = asyncio.create_task(client.get("/work"))
        await asyncio.wait_for(events["work"].wait(), 3)
        server.handle_exit(signal.SIGTERM, None)
        shutdown = asyncio.create_task(server.shutdown())
        try:
            rejected = await client.get("/probe/ready")
            assert rejected.status_code == 503
            assert rejected.json()["reason"] == "shutting_down"
            assert (await client.get("/probe/health")).status_code == 200
            assert not events["stop"].is_set()
            events["release"].set()
            assert (await pending).json() == {"completed": True}
        finally:
            events["release"].set()
            await asyncio.gather(pending, shutdown)
        assert events["stop"].is_set()


async def test_readiness_rechecks_its_gate_after_an_inflight_probe() -> None:
    async with running_server() as (server, client, events):
        checking = asyncio.create_task(client.get("/probe/ready"))
        await asyncio.wait_for(events["probe"].wait(), 3)
        server.handle_exit(signal.SIGTERM, None)
        events["probe_release"].set()
        try:
            assert (await checking).status_code == 503
        finally:
            await server.shutdown()


async def test_timed_out_request_releases_the_listener_and_runs_teardown() -> (
    None
):
    async with running_server(0.25, 0.15) as (server, client, events):
        pending = asyncio.create_task(client.get("/work"))
        await asyncio.wait_for(events["work"].wait(), 3)
        server.handle_exit(signal.SIGTERM, None)
        await asyncio.wait_for(server.shutdown(), 2)
        await asyncio.wait_for(events["leave"].wait(), 2)
        assert events["stop"].is_set()
        reply = await asyncio.gather(pending, return_exceptions=True)
        if isinstance(reply[0], httpx.Response):
            assert reply[0].status_code >= 500
        else:
            assert isinstance(reply[0], httpx.TransportError)


async def test_repeated_term_keeps_the_window_and_interrupt_forces_exit() -> (
    None
):
    async with running_server(withdrawal=30) as (server, client, events):
        server.handle_exit(signal.SIGTERM, None)
        shutdown = asyncio.create_task(server.shutdown())
        server.handle_exit(signal.SIGTERM, None)
        assert not server.force_exit
        assert (await client.get("/probe/ready")).status_code == 503
        server.handle_exit(signal.SIGINT, None)
        await asyncio.wait_for(shutdown, 2)
        assert server.force_exit
        assert not events["stop"].is_set()


async def test_signal_during_startup_cannot_reopen_the_gate() -> None:
    entered, complete = asyncio.Event(), asyncio.Event()

    async def start() -> None:
        entered.set()
        await complete.wait()

    app = create_app(
        title="starting",
        prefix="/probe",
        runtime=Runtime(lifespan_hooks=(LifespanHook("slow", startup=start),)),
    )
    server = HttpServer(app, HttpAppSettings(app_readiness_withdraw_s=0.2))
    runner = app.state.lifespan_runner
    assert isinstance(runner, LifespanRunner)
    first = asyncio.create_task(runner.startup())
    await entered.wait()
    server.handle_exit(signal.SIGTERM, None)
    complete.set()
    await first
    assert not runner.gate.is_ready
    assert runner.gate.reason == "shutting_down"
    await runner.shutdown()
    await runner.startup()
    assert runner.gate.is_ready
    await runner.shutdown()


async def test_resource_hooks_only_receive_what_remains_of_http_drain() -> None:
    opened, closed = asyncio.Event(), asyncio.Event()

    async def pending() -> None:
        opened.set()
        await asyncio.Event().wait()

    async def last() -> None:
        closed.set()

    runner = LifespanRunner(
        (
            LifespanHook("first", shutdown=pending),
            LifespanHook("last", shutdown=last),
        ),
        drain_timeout_s=20,
    )
    loop = asyncio.get_running_loop()
    runner.shutdown_deadline_s = loop.time() + 0.02
    await asyncio.wait_for(runner.shutdown(), 0.5)
    assert opened.is_set()
    assert closed.is_set()


def test_withdrawal_uses_two_seconds_by_default() -> None:
    assert HttpAppSettings().app_readiness_withdraw_s == 2.0
