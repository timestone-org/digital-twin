"""HTTP 出站请求、时钟与并发协调的受控假件。"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import dataclass, field

import httpx

from collector_server.apps.collect.drivers.base import (
    DriverConnection,
    PointSpec,
    RequestLimiter,
)
from collector_server.apps.collect.drivers.http.driver import HttpDriver
from collectwire import DataType

ENDPOINT = "http://127.0.0.1:18080/data"
TOKEN_ENDPOINT = "http://127.0.0.1:18081/token"
NOW_MS = 1_787_544_300_000
SECRET = "http-test-credential"
USER = "test-user"
Handler = Callable[[httpx.Request], httpx.Response | Awaitable[httpx.Response]]


@dataclass
class Clock:
    now_s: float = 100

    def __call__(self) -> float:
        return self.now_s


@dataclass(frozen=True)
class HttpSetup:
    options: Mapping[str, str] = field(default_factory=dict[str, str])
    username: str | None = None
    password: str | None = None
    endpoint: str = ENDPOINT
    allowed_endpoints: frozenset[str] = frozenset(
        {"http://127.0.0.1:18080", "http://127.0.0.1:18081"}
    )
    is_enabled: bool = True
    limiter: RequestLimiter | None = None


def driver_for(
    handler: Handler, setup: HttpSetup | None = None, clock: Clock | None = None
) -> HttpDriver:
    options = setup or HttpSetup()
    driver = HttpDriver(
        connection=DriverConnection(
            endpoint=options.endpoint,
            options=options.options,
            username=options.username,
            password=options.password,
            is_network_access_enabled=options.is_enabled,
            allowed_endpoints=options.allowed_endpoints,
            request_limiter=options.limiter,
        ),
        transport=httpx.MockTransport(handler),
        clock_ms=lambda: NOW_MS,
        clock=clock or Clock(),
    )
    driver.load_points([point()])
    return driver


def point(
    code: str = "value",
    address: str = "/value",
    kind: DataType | None = "float",
) -> PointSpec:
    return PointSpec(code, address, 1000, kind)


@dataclass
class RecordingHandler:
    responses: list[httpx.Response] = field(
        default_factory=lambda: [httpx.Response(200, json={"value": 21.5})]
    )
    requests: list[httpx.Request] = field(default_factory=list[httpx.Request])

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.responses[
            min(len(self.requests) - 1, len(self.responses) - 1)
        ]


@dataclass
class GatedHandler:
    entered: asyncio.Queue[httpx.Request] = field(
        default_factory=asyncio.Queue[httpx.Request]
    )
    released: asyncio.Event = field(default_factory=asyncio.Event)
    cancelled: asyncio.Event = field(default_factory=asyncio.Event)
    requests: list[httpx.Request] = field(default_factory=list[httpx.Request])
    active: int = 0
    peak: int = 0

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        self.active += 1
        self.peak = max(self.peak, self.active)
        self.entered.put_nowait(request)
        try:
            await self.released.wait()
            return httpx.Response(200, json={"value": 21.5})
        except asyncio.CancelledError:
            self.cancelled.set()
            raise
        finally:
            self.active -= 1


class TrackingLimiter:
    def __init__(self, capacity: int = 1) -> None:
        self.semaphore = asyncio.Semaphore(capacity)
        self.queued = asyncio.Event()
        self.active = 0
        self.peak = 0

    async def acquire(self) -> bool:
        self.queued.set()
        await self.semaphore.acquire()
        self.active += 1
        self.peak = max(self.peak, self.active)
        return True

    def release(self) -> None:
        self.active -= 1
        self.semaphore.release()


class ChunkedBody(httpx.AsyncByteStream):
    def __init__(self, chunks: tuple[bytes, ...]) -> None:
        self.chunks = chunks
        self.is_closed = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self.chunks:
            yield chunk

    async def aclose(self) -> None:
        self.is_closed = True
