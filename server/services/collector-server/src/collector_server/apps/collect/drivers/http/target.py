"""HTTP 出站 origin 授权、DNS 校验与请求地址固定（ADR-0057）。"""

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from collector_server.apps.collect.drivers.base import DriverConnection
from collector_server.apps.collect.drivers.http.errors import (
    HttpConfigurationInvalid,
    HttpRequestFailed,
)
from collectwire.http import HttpOptions, http_origin, validate_http_ip


@dataclass(frozen=True)
class HttpTarget:
    """一次解析后固定的请求目标，TLS 仍校验原始 hostname。"""

    url: httpx.URL
    host: str
    hostname: str


def authorize_targets(
    connection: DriverConnection, options: HttpOptions
) -> None:
    """检查开关与端点精确授权。

    Args: connection, options。
    """
    if not connection.is_network_access_enabled:
        raise HttpConfigurationInvalid("HTTP 采集未在采集进程启用")
    try:
        allowed = {http_origin(value) for value in connection.allowed_endpoints}
        endpoints = [connection.endpoint]
        if options.token_endpoint is not None:
            endpoints.append(options.token_endpoint)
        if any(http_origin(value) not in allowed for value in endpoints):
            raise HttpConfigurationInvalid("HTTP 目标未列入采集进程允许清单")
    except ValueError as error:
        raise HttpConfigurationInvalid("HTTP 目标或允许清单不合法") from error


async def resolve_target(endpoint: str) -> HttpTarget:
    """解析一次 DNS 并固定到校验通过的 IP，防止二次解析绕过检查。

    Args: endpoint。
    """
    parsed = urlsplit(endpoint)
    hostname = parsed.hostname or ""
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        try:
            records = await asyncio.get_running_loop().getaddrinfo(
                hostname, port, type=socket.SOCK_STREAM
            )
        except OSError as error:
            raise HttpRequestFailed("HTTP 目标 DNS 解析失败") from error
        addresses = [ipaddress.ip_address(record[4][0]) for record in records]
        if not addresses:
            raise HttpRequestFailed("HTTP 目标 DNS 未返回地址") from None
        for address in addresses:
            _validate_address(address)
        address = addresses[0]
    _validate_address(address)
    return HttpTarget(
        url=httpx.URL(endpoint).copy_with(host=str(address)),
        host=httpx.URL(endpoint).netloc.decode("ascii"),
        hostname=httpx.URL(endpoint).raw_host.decode("ascii"),
    )


def _validate_address(
    address: ipaddress.IPv4Address | ipaddress.IPv6Address,
) -> None:
    try:
        validate_http_ip(address)
    except ValueError as error:
        raise HttpConfigurationInvalid(str(error)) from error
