"""报告 API 有界异步请求，解析后固定 IP 并保留原 Host 与 TLS 校验。"""

import asyncio
import ipaddress
import socket
from collections.abc import Sequence
from dataclasses import dataclass
from http import HTTPStatus
from urllib.parse import urlsplit

import httpx
from pydantic import JsonValue

from collectwire.http import validate_http_ip
from lib.logging import current_traceparent
from platform_server.apps.report.errors import (
    ReportApiReadFailed,
    ReportInvalid,
)
from platform_server.apps.report.schemas.api_source import (
    ReportApiConnection,
    ReportApiSource,
)

MAX_RESPONSE_BYTES = 2_000_000
REQUEST_TIMEOUT_S = 5.0
TOTAL_TIMEOUT_S = 15.0
MAX_SOURCES = 10


@dataclass(frozen=True)
class ApiRequest:
    """已展开的单次查询。"""

    source: ReportApiSource
    connection: ReportApiConnection
    query: dict[str, str]
    body: dict[str, JsonValue] | None


async def _pinned_url(endpoint: str) -> httpx.URL:
    parsed = urlsplit(endpoint)
    hostname = parsed.hostname or ""
    try:
        addresses = [ipaddress.ip_address(hostname)]
    except ValueError:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        records = await asyncio.get_running_loop().getaddrinfo(
            hostname, port, type=socket.SOCK_STREAM
        )
        addresses = [ipaddress.ip_address(record[4][0]) for record in records]
    if not addresses:
        raise ReportApiReadFailed("API 连接未能解析到可用地址")
    for address in addresses:
        validate_http_ip(address)
    return httpx.URL(endpoint).copy_with(host=str(addresses[0]))


async def _read_bytes(response: httpx.Response) -> bytes:
    if not HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES:
        raise ReportApiReadFailed(
            f"API 取数失败（HTTP {response.status_code}）"
        )
    if (
        response.headers.get("Content-Encoding", "identity").casefold()
        != "identity"
    ):
        raise ReportInvalid("API 响应须使用未压缩 JSON")
    payload = bytearray()
    async for chunk in response.aiter_bytes(chunk_size=16_384):
        if len(payload) + len(chunk) > MAX_RESPONSE_BYTES:
            raise ReportInvalid("API 响应超过 2 MB 上限，请缩小查询范围")
        payload.extend(chunk)
    return bytes(payload)


async def _fetch(client: httpx.AsyncClient, wanted: ApiRequest) -> bytes:
    endpoint = wanted.connection.base_url + wanted.source.path
    pinned = await _pinned_url(endpoint)
    original = httpx.URL(endpoint)
    headers = {
        key: value.get_secret_value()
        for key, value in wanted.connection.headers.items()
    }
    headers.update(
        {
            "Host": original.netloc.decode("ascii"),
            "Accept": "application/json",
            "Accept-Encoding": "identity",
        }
    )
    traceparent = current_traceparent()
    if traceparent:
        headers["traceparent"] = traceparent
    request = httpx.Request(
        wanted.source.method,
        pinned,
        headers=headers,
        params=wanted.query,
        json=wanted.body,
        extensions={"sni_hostname": original.raw_host.decode("ascii")},
    )
    response = await client.send(request, stream=True)
    try:
        return await _read_bytes(response)
    finally:
        await response.aclose()


async def fetch_requests(
    requests: Sequence[ApiRequest], transport: httpx.AsyncBaseTransport | None
) -> list[bytes]:
    """顺序请求，共享整体预算且不重试。Args: requests, transport。"""
    if len(requests) > MAX_SOURCES:
        raise ReportInvalid("报告最多允许 10 个 API 取数请求")
    source_name = "报告"
    try:
        async with (
            asyncio.timeout(TOTAL_TIMEOUT_S),
            httpx.AsyncClient(
                timeout=REQUEST_TIMEOUT_S,
                follow_redirects=False,
                trust_env=False,
                transport=transport,
                limits=httpx.Limits(max_keepalive_connections=0),
            ) as client,
        ):
            payloads: list[bytes] = []
            for wanted in requests:
                source_name = wanted.source.name
                async with asyncio.timeout(REQUEST_TIMEOUT_S):
                    payloads.append(await _fetch(client, wanted))
            return payloads
    except (ReportApiReadFailed, ReportInvalid) as error:
        raise type(error)(
            f"数据来源「{source_name}」：{error.message}"
        ) from None
    except (httpx.TimeoutException, TimeoutError):
        raise ReportApiReadFailed(
            f"数据来源「{source_name}」：API 取数超时，请稍后重试"
        ) from None
    except (httpx.HTTPError, OSError):
        raise ReportApiReadFailed(
            f"数据来源「{source_name}」：API 连接失败，请检查服务状态或连接配置"
        ) from None
    except ValueError:
        raise ReportInvalid(
            f"数据来源「{source_name}」：API 连接目标不符合出站访问规则"
        ) from None
