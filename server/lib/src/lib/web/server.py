"""Uvicorn HTTP 入口，收到终止信号即撤去就绪并与生命周期共享 drain 截止时刻。"""

import asyncio
import socket
import time
from contextlib import suppress
from types import FrameType
from typing import override

import uvicorn
from fastapi import FastAPI

from lib.config import HttpAppSettings
from lib.lifespan import LifespanRunner


class HttpServer(uvicorn.Server):
    """先公布未就绪，随后交给 Uvicorn 关闭监听、收束连接和执行 ASGI 关停。"""

    def __init__(self, app: FastAPI, settings: HttpAppSettings) -> None:
        runner = app.state.lifespan_runner
        if not isinstance(runner, LifespanRunner):
            raise TypeError("HTTP 应用缺少共享生命周期")
        super().__init__(
            uvicorn.Config(
                app,
                host=settings.app_http_host,
                port=settings.app_http_port,
                log_config=None,
                access_log=False,
            )
        )
        self._runner = runner
        self._withdraw_s = settings.app_readiness_withdraw_s
        self._withdraw_until: float | None = None
        self._force = asyncio.Event()

    @override
    def handle_exit(self, sig: int, frame: FrameType | None) -> None:
        if self._withdraw_until is None:
            window = self._withdraw_s if self._runner.gate.is_ready else 0.0
            self._withdraw_until = time.monotonic() + window
            self._runner.withdraw()
        super().handle_exit(sig, frame)
        if self.force_exit:
            self._force.set()

    @override
    async def shutdown(
        self, sockets: list[socket.socket] | None = None
    ) -> None:
        if self._withdraw_until is not None and not self.force_exit:
            remaining = self._withdraw_until - time.monotonic()
            with suppress(TimeoutError):
                await asyncio.wait_for(self._force.wait(), timeout=remaining)
        self._runner.shutdown_deadline_s = (
            asyncio.get_running_loop().time() + self._runner.drain_timeout_s
        )
        await super().shutdown(sockets)

    @override
    async def _wait_tasks_to_complete(self) -> None:
        # Uvicorn 在捕获此超时时取消请求，随后仍按正常流程通知 ASGI 关停。
        async with asyncio.timeout_at(self._runner.shutdown_deadline_s):
            await super()._wait_tasks_to_complete()


def serve_http(app: FastAPI, settings: HttpAppSettings) -> None:
    """按当前进程的 HTTP 和摘流配置启动共享监听器。Args: app, settings。"""
    HttpServer(app, settings).run()
