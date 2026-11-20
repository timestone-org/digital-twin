"""管理面登记的机器身份通过本地签名加密通道建立会话。"""

from __future__ import annotations

from dataclasses import dataclass
from functools import partial
from typing import TYPE_CHECKING

import pytest
from asyncua import Client, ua
from asyncua.crypto.security_policies import SecurityPolicyBasic256Sha256

from integration.security_helpers import INSTANCES, certificate_pair
from opcua_server.apps.instance.deps import PERM_MANAGE, PERM_OPERATE, PERM_VIEW
from opcua_server.apps.instance.runtime.instance import LOOPBACK, InstanceSpec
from opcua_server.apps.instance.services import instance_service

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

    import httpx

    from integration.security_helpers import Headers
    from opcua_server.settings import Settings

pytestmark = [
    pytest.mark.requires_postgres,
    pytest.mark.usefixtures("clean_tables"),
]


@dataclass(frozen=True)
class Endpoint:
    route: str
    url: str
    certificate: Path


@dataclass(frozen=True)
class ClientKeys:
    certificate: Path
    key: Path

    @classmethod
    def issue(cls, directory: Path, name: str) -> ClientKeys:
        pem, private = certificate_pair()
        cert_path = directory / f"{name}.pem"
        key_path = directory / f"{name}.key.pem"
        cert_path.write_text(pem)
        key_path.write_text(private)
        key_path.chmod(0o600)
        return cls(cert_path, key_path)


@pytest.fixture
async def endpoint(
    client: httpx.AsyncClient,
    sign_headers: Headers,
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[Endpoint]:
    monkeypatch.setattr(
        instance_service, "InstanceSpec", partial(InstanceSpec, host=LOOPBACK)
    )
    response = await client.post(
        INSTANCES,
        json={
            "name": "identity-check",
            "namespace_uri": "urn:test:identity",
            "security_policies": ["Basic256Sha256_SignAndEncrypt"],
            "is_anonymous_allowed": True,
        },
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.status_code == 201
    item = response.json()["data"]
    route = f"{INSTANCES}/{item['id']}"
    started = await client.post(
        f"{route}:start", headers=sign_headers(PERM_OPERATE)
    )
    assert started.status_code == 200
    try:
        yield Endpoint(
            route,
            f"opc.tcp://{LOOPBACK}:{item['port']}{item['endpoint_path']}",
            settings.pki_dir / f"{item['id']}.der",
        )
    finally:
        stopped = await client.post(
            f"{route}:stop", headers=sign_headers(PERM_OPERATE)
        )
        assert stopped.status_code == 200


async def secure_client(endpoint: Endpoint, keys: ClientKeys) -> Client:
    native = Client(endpoint.url, timeout=5)
    await native.set_security(
        SecurityPolicyBasic256Sha256,
        keys.certificate,
        keys.key,
        server_certificate=str(endpoint.certificate),
    )
    return native


async def session_names(
    client: httpx.AsyncClient, endpoint: Endpoint, headers: Headers
) -> list[str | None]:
    result = await client.get(
        f"{endpoint.route}/sessions", headers=headers(PERM_VIEW)
    )
    assert result.status_code == 200
    return [item["username"] for item in result.json()["data"]]


async def test_registered_username_is_used_on_a_live_instance(
    client: httpx.AsyncClient,
    endpoint: Endpoint,
    tmp_path: Path,
    sign_headers: Headers,
) -> None:
    route = f"{endpoint.route}/credentials"
    created = await client.post(
        route, json={"username": "qa_reader"}, headers=sign_headers(PERM_MANAGE)
    )
    assert created.status_code == 201
    issued = created.json()["data"]
    keys = ClientKeys.issue(tmp_path, "application")
    native = await secure_client(endpoint, keys)
    native.set_user("qa_reader")
    native.set_password(issued["password"])
    async with native:
        assert (await native.nodes.objects.read_browse_name()).Name == "Objects"
        assert await session_names(client, endpoint, sign_headers) == [
            "qa_reader"
        ]
    removed = await client.delete(
        f"{route}/{issued['credential']['id']}",
        headers=sign_headers(PERM_MANAGE),
    )
    assert removed.status_code == 204
    with pytest.raises(ua.UaStatusCodeError) as denied:
        async with native:
            pytest.fail("已撤销的合成凭据仍建立了新会话")
    assert denied.value.code == ua.StatusCodes.BadUserAccessDenied


async def test_signed_channel_and_user_certificate_have_independent_identities(
    client: httpx.AsyncClient,
    endpoint: Endpoint,
    tmp_path: Path,
    sign_headers: Headers,
) -> None:
    channel = ClientKeys.issue(tmp_path, "application")
    user = ClientKeys.issue(tmp_path, "user")
    route = f"{endpoint.route}/trusted-certificates"
    registered = await client.post(
        route,
        json={"certificate_pem": user.certificate.read_text()},
        headers=sign_headers(PERM_MANAGE),
    )
    assert registered.status_code == 201
    native = await secure_client(endpoint, channel)
    async with native:
        assert (await native.nodes.objects.read_browse_name()).Name == "Objects"
        assert await session_names(client, endpoint, sign_headers) == [None]
    identified = await secure_client(endpoint, channel)
    await identified.load_client_certificate(str(user.certificate))
    await identified.load_private_key(str(user.key))
    async with identified:
        assert (
            await identified.nodes.objects.read_browse_name()
        ).Name == "Objects"
        assert await session_names(client, endpoint, sign_headers) == [
            registered.json()["data"]["subject"]
        ]
    revoked = await client.delete(
        f"{route}/{registered.json()['data']['id']}",
        headers=sign_headers(PERM_MANAGE),
    )
    assert revoked.status_code == 204
    with pytest.raises(ua.UaStatusCodeError) as denied:
        async with identified:
            pytest.fail("已撤销的合成证书仍建立了新会话")
    assert denied.value.code == ua.StatusCodes.BadUserAccessDenied
