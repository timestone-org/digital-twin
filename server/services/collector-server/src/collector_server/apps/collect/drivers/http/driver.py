"""HTTP JSON 轮询驱动，每轮请求一次并解析多个点位（ADR-0057）。"""

import asyncio
import hashlib
import time
from collections.abc import Callable, Sequence

import httpx
from pydantic import JsonValue

from collector_server.apps.collect.drivers.base import (
    BrowseItem,
    BrowseNotSupported,
    DriverCapabilities,
    DriverConnection,
    DriverNotConnected,
    ErrorCategory,
    PointSpec,
    Sample,
    SubscribeResult,
    ValueSink,
    WriteNotSupported,
)
from collector_server.apps.collect.drivers.http.auth import HttpAuthentication
from collector_server.apps.collect.drivers.http.errors import (
    HttpAuthenticationRejected,
    HttpConfigurationInvalid,
    HttpRequestFailed,
    HttpResponseInvalid,
)
from collector_server.apps.collect.drivers.http.mapping import (
    convert_value,
    resolve_pointer,
)
from collector_server.apps.collect.drivers.http.target import (
    authorize_targets,
    resolve_target,
)
from collector_server.apps.collect.drivers.http.transport import (
    bound_response,
    fetch_json,
)
from collector_server.clock import utc_now_ms
from collectwire.http import HttpOptions, validate_http_pointer

CAPABILITIES = DriverCapabilities(
    is_subscribe_supported=False,
    is_browse_supported=False,
    is_write_supported=False,
    minimum_poll_interval_ms=1000,
    is_empty_source_connection_supported=False,
)


class HttpDriver:
    """每源一个异步客户端，读数逐位对齐、错误逐点隔离。"""

    def __init__(
        self,
        *,
        connection: DriverConnection,
        transport: httpx.AsyncBaseTransport | None = None,
        clock_ms: Callable[[], int] = utc_now_ms,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._connection = connection
        try:
            self._options = HttpOptions.from_options(connection.options)
        except ValueError as error:
            raise HttpConfigurationInvalid("HTTP 请求配置不合法") from error
        self._authentication = HttpAuthentication(
            connection, self._options, clock
        )
        self._transport = transport
        self._clock_ms = clock_ms
        self._client: httpx.AsyncClient | None = None
        self._points: dict[str, PointSpec] = {}
        self._single_flight = asyncio.Semaphore(1)
        self._last_error: BaseException | None = None
        self._is_revoked = False
        self._requests: set[asyncio.Task[JsonValue]] = set()

    @property
    def capabilities(self) -> DriverCapabilities:
        return CAPABILITIES

    def load_points(self, points: Sequence[PointSpec]) -> int:
        accepted: dict[str, PointSpec] = {}
        for point in points:
            try:
                validate_http_pointer(point.address)
            except ValueError:
                continue
            accepted[point.point_code] = point
        self._points = accepted
        return len(accepted)

    async def connect(self) -> None:
        self._check_revocation()
        authorize_targets(self._connection, self._options)
        await self.disconnect()
        self._client = httpx.AsyncClient(
            timeout=self._options.timeout_s,
            transport=self._transport,
            follow_redirects=False,
            trust_env=False,
            headers={
                "Accept": "application/json",
                "Accept-Encoding": "identity",
            },
            # ⚠ IP 池键不能区分原域名，须逐请求校验证书（ADR-0057）。
            limits=httpx.Limits(max_connections=1, max_keepalive_connections=0),
            event_hooks={"response": [bound_response]},
        )
        self._last_error = None

    async def disconnect(self) -> None:
        client, self._client = self._client, None
        self._authentication.clear()
        if client is not None:
            await client.aclose()

    def revoke(self) -> None:
        self._is_revoked = True
        self._authentication.clear()
        for task in self._requests:
            task.cancel()

    async def healthcheck(self) -> None:
        self._connected_client()
        if self._last_error is not None:
            raise self._last_error

    async def read_many(self, point_codes: Sequence[str]) -> list[Sample]:
        if not point_codes:
            # ⚠ 命令总线用空点位列表测试连接，必须实际向上游探测且传播失败。
            await self._read_document()
            self._last_error = None
            return []
        selected = {
            code: self._points[code]
            for code in point_codes
            if code in self._points
        }
        if not selected:
            return [(None, self._clock_ms(), "bad") for _ in point_codes]
        if (
            self._last_error is not None
            and self.classify_error(self._last_error) != "transient"
        ):
            return [(None, self._clock_ms(), "bad") for _ in point_codes]
        try:
            document = await self._read_document()
            self._last_error = None
        except (
            HttpRequestFailed,
            HttpResponseInvalid,
            HttpAuthenticationRejected,
            HttpConfigurationInvalid,
        ) as error:
            self._last_error = error
            now = self._clock_ms()
            return [(None, now, "bad") for _ in point_codes]
        now = self._clock_ms()
        return [
            self._sample(document, selected.get(code), now)
            for code in point_codes
        ]

    async def _read_document(self) -> JsonValue:
        self._check_revocation()
        task = asyncio.create_task(self._request_document())
        self._requests.add(task)
        try:
            return await task
        except asyncio.CancelledError:
            current = asyncio.current_task()
            if self._is_revoked and (
                current is None or not current.cancelling()
            ):
                raise DriverNotConnected("采集租约已经失效") from None
            raise
        finally:
            self._requests.discard(task)

    async def _request_document(self) -> JsonValue:
        try:
            async with asyncio.timeout(self._options.timeout_s):
                async with self._single_flight:
                    return await self._limited_read()
        except TimeoutError as error:
            raise HttpRequestFailed("HTTP 请求超过总超时预算") from error

    async def _limited_read(self) -> JsonValue:
        limiter = self._connection.request_limiter
        if limiter is not None:
            await limiter.acquire()
        try:
            client = self._connected_client()
            headers = self._options.headers()
            headers.update(await self._authentication.headers(client))
            self._check_revocation()
            target = await resolve_target(self._connection.endpoint)
            self._check_revocation()
            request = client.build_request(
                self._options.method,
                target.url.copy_merge_params(self._options.query()),
                headers=headers,
                content=self._options.body_json,
            )
            if self._options.body_json is not None:
                request.headers["Content-Type"] = "application/json"
            return await fetch_json(
                client,
                target,
                max_bytes=self._options.max_response_bytes,
                request=request,
                auth=self._authentication.challenge_auth(),
            )
        finally:
            if limiter is not None:
                limiter.release()

    def _connected_client(self) -> httpx.AsyncClient:
        self._check_revocation()
        if self._client is None or self._client.is_closed:
            raise DriverNotConnected("HTTP 会话尚未连接")
        return self._client

    def _check_revocation(self) -> None:
        if self._is_revoked:
            raise DriverNotConnected("采集租约已经失效")

    @staticmethod
    def _sample(
        document: JsonValue, point: PointSpec | None, now: int
    ) -> Sample:
        if point is None:
            return None, now, "bad"
        try:
            value = convert_value(
                resolve_pointer(document, point.address), point.data_type
            )
        except (ValueError, OverflowError):
            return None, now, "bad"
        return value, now, "good"

    async def subscribe(
        self, points: Sequence[PointSpec], on_value: ValueSink
    ) -> SubscribeResult:
        del points, on_value
        raise BrowseNotSupported("HTTP 采集使用轮询")

    async def unsubscribe(self, point_codes: Sequence[str]) -> int:
        del point_codes
        return 0

    async def write(self, point_code: str, value: object) -> None:
        del point_code, value
        raise WriteNotSupported("HTTP 采集驱动只读")

    async def browse(self, parent: str | None) -> list[BrowseItem]:
        del parent
        raise BrowseNotSupported("HTTP 请通过样例 JSON 配置点位路径")

    def fingerprint(self) -> tuple[str, ...]:
        fields = [
            self._connection.endpoint,
            self._connection.username or "",
            self._connection.password or "",
        ]
        fields.extend(
            f"{key}={value}"
            for key, value in sorted(self._connection.options.items())
        )
        return (hashlib.sha256("\0".join(fields).encode()).hexdigest(),)

    def classify_error(self, error: BaseException) -> ErrorCategory:
        if isinstance(error, HttpAuthenticationRejected):
            return "auth"
        if isinstance(
            error, (HttpConfigurationInvalid, HttpResponseInvalid, ValueError)
        ):
            return "config"
        return "transient"
