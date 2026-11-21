"""管理面、原生发现和实例证书使用同一个通告主机。"""

import socket
from collections.abc import Callable
from urllib.parse import urlsplit

import httpx
import pytest
from asyncua import Client
from cryptography import x509

from opcua_server.apps.instance.deps import PERM_MANAGE, PERM_OPERATE, PERM_VIEW
from opcua_server.settings import API_PREFIX, Settings

pytestmark = pytest.mark.requires_postgres
HOST = "opcua-node.example.test"
INSTANCES = f"{API_PREFIX}/instances"


@pytest.fixture(scope="session")
def settings(
    settings: Settings, tmp_path_factory: pytest.TempPathFactory
) -> Settings:
    """本组使用仅作通告的域名，连接走本机。Args: settings, tmp_path_factory。"""
    return settings.model_copy(
        update={
            "advertised_host": HOST,
            "pki_dir": tmp_path_factory.mktemp("advertised-host"),
        }
    )


@pytest.mark.usefixtures("clean_tables")
async def test_saved_and_serving_endpoints_use_the_advertised_host(
    client: httpx.AsyncClient, sign_headers: Callable[..., dict[str, str]]
) -> None:
    created = await client.post(
        INSTANCES,
        json={
            "name": "advertised",
            "namespace_uri": "urn:qa:advertised",
            "security_policies": ["Basic256Sha256_SignAndEncrypt"],
        },
        headers=sign_headers(PERM_MANAGE),
    )
    assert created.status_code == httpx.codes.CREATED
    data = created.json()["data"]
    path = f"{INSTANCES}/{data['id']}"
    started = await client.post(
        path + ":start", headers=sign_headers(PERM_OPERATE)
    )
    assert started.status_code == httpx.codes.OK
    actual = await client.get(path, headers=sign_headers(PERM_VIEW))
    for response in (created, started, actual):
        shown = urlsplit(response.json()["data"]["endpoint_url"])
        assert (shown.hostname, shown.port, shown.path) == (
            HOST,
            data["port"],
            data["endpoint_path"],
        )
    probe = f"opc.tcp://127.0.0.1:{data['port']}{data['endpoint_path']}"
    endpoints = await Client(probe).connect_and_get_server_endpoints()
    assert {urlsplit(e.EndpointUrl).hostname for e in endpoints} == {HOST}
    certificate = x509.load_der_x509_certificate(endpoints[0].ServerCertificate)
    san = certificate.extensions.get_extension_for_class(
        x509.SubjectAlternativeName
    ).value
    assert {HOST, socket.gethostname()} <= set(
        san.get_values_for_type(x509.DNSName)
    )
