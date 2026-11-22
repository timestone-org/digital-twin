"""实例的公开证书可由浏览者下载并与已登记指纹核对。"""

from hashlib import sha256
from uuid import UUID

import httpx
import pytest
from cryptography import x509

from integration.security_helpers import (
    INSTANCES,
    Headers,
    create_security_instance,
)
from opcua_server.apps.instance.deps import PERM_OPERATE, PERM_VIEW
from opcua_server.apps.instance.runtime.pki import PkiStore

pytestmark = [
    pytest.mark.requires_postgres,
    pytest.mark.usefixtures("clean_tables"),
]


async def test_running_instance_download_matches_native_certificate(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    instance_id = await create_security_instance(client, sign_headers)
    path = f"{INSTANCES}/{instance_id}"
    viewer = sign_headers(PERM_VIEW)
    download = f"{path}/server-certificates/current"

    before = await client.get(download, headers=viewer)
    assert before.status_code == 404
    started = await client.post(
        path + ":start", headers=sign_headers(PERM_OPERATE)
    )
    assert started.status_code == 200
    instance = await client.get(path, headers=viewer)
    certificate = instance.json()["data"]["certificate"]

    response = await client.get(download, headers=viewer)
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "application/pkix-cert"
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Content-Disposition"].endswith('.der"')
    assert sha256(response.content).hexdigest() == certificate["fingerprint"]
    assert x509.load_der_x509_certificate(
        response.content
    ).subject.rfc4514_string()
    assert certificate["is_download_supported"] is True


@pytest.mark.parametrize("problem", ["unreadable", "version", "fingerprint"])
async def test_download_reports_unavailable_when_registration_is_stale(
    client: httpx.AsyncClient,
    sign_headers: Headers,
    monkeypatch: pytest.MonkeyPatch,
    problem: str,
) -> None:
    instance_id = await create_security_instance(client, sign_headers)
    path = f"{INSTANCES}/{instance_id}"
    started = await client.post(
        path + ":start", headers=sign_headers(PERM_OPERATE)
    )
    assert started.status_code == 200

    async def read_certificate(_store: PkiStore, _instance_id: UUID) -> bytes:
        if problem == "unreadable":
            raise FileNotFoundError()
        if problem == "version":
            raise x509.InvalidVersion("测试证书版本不可用", 4)
        return b"nonmatching-local-test-bytes"

    monkeypatch.setattr(PkiStore, "read_certificate_der", read_certificate)
    result = await client.get(
        f"{path}/server-certificates/current", headers=sign_headers(PERM_VIEW)
    )
    assert result.status_code == 503
    assert result.json()["code"] == 52103
