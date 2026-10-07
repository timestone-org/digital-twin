"""原域名共用固定 IP 时，OAuth Secure Cookie 不得跨到数据域。"""

import asyncio
import socket
from pathlib import Path

import certifi
import pytest

from collector_server.apps.collect.drivers.base import (
    DriverConnection,
    PointSpec,
)
from collector_server.apps.collect.drivers.http.driver import HttpDriver
from integration.http_tls_helpers import TlsEndpoint, certificate, local_tls


def _driver(endpoint: TlsEndpoint) -> HttpDriver:
    driver = HttpDriver(
        connection=DriverConnection(
            endpoint=endpoint.endpoint("data.test", "/data"),
            options={
                "auth_type": "oauth2_client_credentials",
                "token_endpoint": endpoint.endpoint("token.test", "/token"),
            },
            username="test-client",
            password="test-client-secret",
            is_network_access_enabled=True,
            allowed_endpoints=frozenset(
                endpoint.endpoint(hostname, "")
                for hostname in ("data.test", "token.test")
            ),
        ),
        clock_ms=lambda: 1234,
    )
    driver.load_points([PointSpec("value", "/value", 1000, "int")])
    return driver


async def test_oauth_secure_cookie_never_crosses_original_https_origins(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    context, certificate_path = certificate(
        tmp_path, ("token.test", "data.test")
    )
    monkeypatch.setattr(certifi, "where", lambda: str(certificate_path))

    async def addresses(_host: object, port: int, **_: object):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port))
        ]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", addresses)
    async with local_tls(
        context,
        cookie_header="session=local-only-cookie; Path=/; Secure; HttpOnly",
    ) as endpoint:
        driver = _driver(endpoint)
        await driver.connect()
        try:
            for _ in range(3):
                assert await driver.read_many(["value"]) == [(42, 1234, "good")]
            assert endpoint.requests == [
                (f"token.test:{endpoint.port}", "/token"),
                *[(f"data.test:{endpoint.port}", "/data")] * 3,
            ]
            assert all(
                "cookie" not in headers for headers in endpoint.request_headers
            )
        finally:
            await driver.disconnect()
