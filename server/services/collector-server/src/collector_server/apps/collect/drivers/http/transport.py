"""有总超时与响应体积上限的异步 HTTP JSON 请求。"""

import math
from collections.abc import AsyncIterator
from http import HTTPStatus

import httpx
from pydantic import JsonValue, TypeAdapter, ValidationError

from collector_server.apps.collect.drivers.http.errors import (
    HttpAuthenticationRejected,
    HttpConfigurationInvalid,
    HttpRequestFailed,
    HttpResponseInvalid,
)
from collector_server.apps.collect.drivers.http.target import HttpTarget
from collectwire.http import MAX_JSON_DEPTH

TOKEN_RESPONSE_MAX_BYTES = 65_536
RESPONSE_LIMIT_KEY = "collect_response_max_bytes"


class BoundedStream(httpx.AsyncByteStream):
    """所有 HTTP 响应共有的流大小上限，包括 Digest 中间挑战响应。"""

    def __init__(self, stream: httpx.AsyncByteStream, max_bytes: int) -> None:
        self._stream = stream
        self._max_bytes = max_bytes

    async def __aiter__(self) -> AsyncIterator[bytes]:
        size_bytes = 0
        async for chunk in self._stream:
            size_bytes += len(chunk)
            if size_bytes > self._max_bytes:
                raise HttpResponseInvalid("HTTP 响应超过大小上限")
            yield chunk

    async def aclose(self) -> None:
        await self._stream.aclose()


async def bound_response(response: httpx.Response) -> None:
    """在认证处理前约束每条响应流。

    Args: response。
    """
    maximum = response.request.extensions.get(RESPONSE_LIMIT_KEY)
    if not isinstance(maximum, int):
        raise HttpResponseInvalid("HTTP 响应缺少大小预算")
    if (
        response.headers.get("Content-Encoding", "identity").casefold()
        != "identity"
    ):
        await response.aclose()
        raise HttpResponseInvalid("HTTP 响应须使用未压缩 JSON")
    if response.is_stream_consumed:
        if len(response.content) > maximum:
            await response.aclose()
            raise HttpResponseInvalid("HTTP 响应超过大小上限")
    else:
        if not isinstance(response.stream, httpx.AsyncByteStream):
            await response.aclose()
            raise HttpResponseInvalid("HTTP 响应不是异步字节流")
        response.stream = BoundedStream(response.stream, maximum)


async def fetch_json(
    client: httpx.AsyncClient,
    target: HttpTarget,
    *,
    max_bytes: int,
    request: httpx.Request,
    auth: httpx.Auth | None = None,
) -> JsonValue:
    """读取受限 JSON 流，不将上游异常文本透出。

    Args: client, target, max_bytes, request。
    """
    request.headers["Host"] = target.host
    request.extensions["sni_hostname"] = target.hostname
    request.extensions[RESPONSE_LIMIT_KEY] = max_bytes
    try:
        response = await client.send(request, auth=auth, stream=True)
        try:
            _check_status(response.status_code)
            if (
                response.headers.get("Content-Encoding", "identity")
                != "identity"
            ):
                raise HttpResponseInvalid("HTTP 响应须使用未压缩 JSON")
            payload = bytearray()
            async for chunk in response.aiter_bytes(chunk_size=16_384):
                if len(payload) + len(chunk) > max_bytes:
                    raise HttpResponseInvalid("HTTP 响应超过大小上限")
                payload.extend(chunk)
        finally:
            await response.aclose()
        adapter: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)
        document = adapter.validate_json(bytes(payload))
        _validate_document(document)
        return document
    except (httpx.HTTPError, OSError, TimeoutError) as error:
        raise HttpRequestFailed("HTTP 请求未完成") from error
    except (ValidationError, RecursionError) as error:
        raise HttpResponseInvalid("HTTP 响应不是合法 JSON") from error


def _validate_document(document: JsonValue) -> None:
    pending: list[tuple[JsonValue, int]] = [(document, 0)]
    while pending:
        value, depth = pending.pop()
        if depth > MAX_JSON_DEPTH:
            raise HttpResponseInvalid("HTTP 响应 JSON 超过深度上限")
        if isinstance(value, float) and not math.isfinite(value):
            raise HttpResponseInvalid("HTTP 响应包含非有限数值")
        if isinstance(value, dict):
            pending.extend((child, depth + 1) for child in value.values())
        elif isinstance(value, list):
            pending.extend((child, depth + 1) for child in value)


def _check_status(status: int) -> None:
    if status in (HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN):
        raise HttpAuthenticationRejected("HTTP 认证或上游权限被拒绝")
    if (
        status == HTTPStatus.TOO_MANY_REQUESTS
        or status >= HTTPStatus.INTERNAL_SERVER_ERROR
    ):
        raise HttpRequestFailed(f"HTTP 上游暂时不可用（{status}）")
    if not HTTPStatus.OK <= status < HTTPStatus.MULTIPLE_CHOICES:
        raise HttpConfigurationInvalid(f"HTTP 上游拒绝请求（{status}）")
