"""OAuth 与数据域共用 IP 时，各自仍必须验证 HTTPS 主机证书。"""

import asyncio
import socket
import ssl
from pathlib import Path

import certifi
import pytest

from collector_server.apps.collect.drivers.base import (
    DriverConnection,
    PointSpec,
)
from collector_server.apps.collect.drivers.http.driver import HttpDriver
from integration.http_tls_helpers import (
    TlsEndpoint,
    certificate,
    local_tls,
)


@pytest.fixture
def tls_certificate(
    tmp_path: Path, request: pytest.FixtureRequest
) -> tuple[ssl.SSLContext, Path]:
    return certificate(tmp_path, request.param)


def _driver(endpoint: TlsEndpoint) -> HttpDriver:
    driver = HttpDriver(
        connection=DriverConnection(
            endpoint=endpoint.endpoint("data.test", "/data"),
            options={
                "auth_type": "oauth2_client_credentials",
                "token_endpoint": endpoint.endpoint("token.test", "/token"),
            },
            username="client",
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


@pytest.mark.parametrize(
    ("tls_certificate", "expected"),
    [
        (("token.test",), (None, 1234, "bad")),
        (("token.test", "data.test"), (42, 1234, "good")),
    ],
    indirect=["tls_certificate"],
    ids=["wrong-data-certificate", "both-hosts-certified"],
)
async def test_shared_ip_preserves_each_https_hostname_verification(
    tls_certificate: tuple[ssl.SSLContext, Path],
    expected: tuple[object, int, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context, certificate_path = tls_certificate
    monkeypatch.setattr(certifi, "where", lambda: str(certificate_path))

    async def addresses(_host: object, port: int, **_: object):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port))
        ]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", addresses)
    async with local_tls(context) as endpoint:
        driver = _driver(endpoint)
        await driver.connect()
        try:
            assert await driver.read_many(["value"]) == [expected]
            assert endpoint.sni_names == ["token.test", "data.test"]
            expected_paths = (
                ["/token", "/data"] if expected[2] == "good" else ["/token"]
            )
            assert [path for _, path in endpoint.requests] == expected_paths
        finally:
            await driver.disconnect()
