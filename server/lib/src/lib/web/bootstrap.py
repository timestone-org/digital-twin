"""`create_app()` 工厂：中间件顺序、异常映射、响应包装、探针由此单点保证。"""

import asyncio
from collections.abc import AsyncGenerator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass

from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse

from lib.errors.handlers import register_exception_handlers
from lib.lifespan import LifespanHook, LifespanRunner, ReadinessGate
from lib.logging.logger import get_logger
from lib.web.middleware import RequestContextMiddleware

_logger = get_logger("lib.web.bootstrap")

# 单项就绪探针的上限。冷连接池首次建连要走完整握手，1s 在跨网段部署下会误判
READINESS_PROBE_TIMEOUT_S = 3.0


@dataclass(frozen=True)
class ReadinessProbe:
    """就绪探针的一项依赖检查。返回 False 或抛异常均视为未就绪。"""

    name: str
    check: Callable[[], Awaitable[bool]]


def _health_paths(prefix: str) -> frozenset[str]:
    return frozenset({f"{prefix}/health", f"{prefix}/ready"})


async def _probe_all(probes: Sequence[ReadinessProbe]) -> list[str]:
    failed: list[str] = []
    for probe in probes:
        try:
            async with asyncio.timeout(READINESS_PROBE_TIMEOUT_S):
                healthy = await probe.check()
        except Exception as error:
            _logger.warning(
                "readiness_probe_failed",
                "就绪探针异常",
                probe=probe.name,
                error=error,
            )
            healthy = False
        if not healthy:
            failed.append(probe.name)
    return failed


def _mount_probes(
    app: FastAPI,
    *,
    prefix: str,
    gate: ReadinessGate,
    probes: Sequence[ReadinessProbe],
) -> None:
    async def health() -> JSONResponse:
        # ⚠ liveness 绝不查依赖：依赖抖动会引发全副本重启风暴
        return JSONResponse(status_code=200, content={"status": "alive"})

    async def ready() -> JSONResponse:
        if not gate.is_ready:
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready", "reason": gate.reason},
            )
        failed = await _probe_all(probes)
        if failed:
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready", "failed": failed},
            )
        return JSONResponse(status_code=200, content={"status": "ready"})

    router = APIRouter(prefix=prefix, tags=["probe"])
    router.add_api_route("/health", health, methods=["GET"], summary="存活探针")
    router.add_api_route("/ready", ready, methods=["GET"], summary="就绪探针")
    app.include_router(router)


@dataclass(frozen=True)
class Runtime:
    """进程生命周期相关的装配项：启动钩子、就绪探针、drain 上限。"""

    lifespan_hooks: Sequence[LifespanHook] = ()
    readiness_probes: Sequence[ReadinessProbe] = ()
    drain_timeout_s: float = 20.0


DEFAULT_RUNTIME = Runtime()


def create_app(
    *,
    title: str,
    prefix: str,
    routers: Sequence[APIRouter] = (),
    runtime: Runtime = DEFAULT_RUNTIME,
) -> FastAPI:
    """按统一约定装配 FastAPI 实例。

    Args: title, prefix（对外路径前缀）, routers, runtime。
    """
    runner = LifespanRunner(
        hooks=tuple(runtime.lifespan_hooks),
        drain_timeout_s=runtime.drain_timeout_s,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
        await runner.startup()
        try:
            yield
        finally:
            await runner.shutdown()

    app = FastAPI(
        title=title,
        docs_url=f"{prefix}/docs",
        redoc_url=f"{prefix}/redoc",
        openapi_url=f"{prefix}/openapi.json",
        lifespan=lifespan,
    )
    app.add_middleware(
        RequestContextMiddleware, health_paths=_health_paths(prefix)
    )
    register_exception_handlers(app)
    _mount_probes(
        app, prefix=prefix, gate=runner.gate, probes=runtime.readiness_probes
    )
    for router in routers:
        app.include_router(router)
    return app
