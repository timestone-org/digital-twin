"""上位机身份面：会话、凭据、信任证书。"""

import datetime as dt
from collections.abc import Callable

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from opcua_server.apps.instance.deps import (
    PERM_MANAGE,
    PERM_OPERATE,
    PERM_VIEW,
)
from opcua_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

INSTANCES = f"{API_PREFIX}/instances"
OK = 200
CREATED = 201
NO_CONTENT = 204
BAD_REQUEST = 400
FORBIDDEN = 403
NOT_FOUND = 404

Headers = Callable[..., dict[str, str]]
RSA_BITS = 2048
MIN_PASSWORD_LENGTH = 12


def _self_signed_pem() -> tuple[str, str]:
    """造一张自签客户端证书，返回 (证书 PEM, 私钥 PEM)。"""
    key = rsa.generate_private_key(public_exponent=65537, key_size=RSA_BITS)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test-scada")])
    now = dt.datetime.now(dt.UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=365))
        .sign(key, hashes.SHA256())
    )
    cert_pem = certificate.public_bytes(serialization.Encoding.PEM).decode()
    key_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    return cert_pem, key_pem


async def _instance(client: httpx.AsyncClient, headers: Headers) -> str:
    response = await client.post(
        INSTANCES,
        json={
            "name": "sec-host",
            "namespace_uri": "urn:test:sec",
            "security_policies": ["Basic256Sha256_SignAndEncrypt"],
        },
        headers=headers(PERM_MANAGE),
    )
    assert response.status_code == CREATED
    return str(response.json()["data"]["id"])


@pytest.mark.usefixtures("clean_tables")
async def test_sessions_are_empty_when_stopped(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """实例没在跑时会话列表是空数组，不是 404。

    ⚠ 「空」与「查不到」对调用方含义不同：前者说明没人连，后者说明实例没了。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    response = await client.get(
        f"{INSTANCES}/{instance_id}/sessions", headers=sign_headers(PERM_VIEW)
    )
    assert response.status_code == OK
    assert response.json()["data"] == []


@pytest.mark.usefixtures("clean_tables")
async def test_credential_password_is_returned_exactly_once(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """明文口令只在创建时出现，列表里再也拿不到。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    created = await client.post(
        f"{INSTANCES}/{instance_id}/credentials",
        json={"username": "scada01"},
        headers=sign_headers(PERM_MANAGE),
    )
    assert created.status_code == CREATED
    body = created.json()["data"]
    assert len(body["password"]) >= MIN_PASSWORD_LENGTH

    listed = await client.get(
        f"{INSTANCES}/{instance_id}/credentials",
        headers=sign_headers(PERM_MANAGE),
    )
    entries = listed.json()["data"]
    assert entries[0]["username"] == "scada01"
    assert "password" not in entries[0]
    assert "hashed_password" not in entries[0]


@pytest.mark.usefixtures("clean_tables")
async def test_credential_accepts_an_explicit_password(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """给了口令就用给的那个。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    created = await client.post(
        f"{INSTANCES}/{instance_id}/credentials",
        json={"username": "scada02", "password": "correct-horse-battery"},
        headers=sign_headers(PERM_MANAGE),
    )
    assert created.json()["data"]["password"] == "correct-horse-battery"


@pytest.mark.usefixtures("clean_tables")
async def test_short_password_is_rejected(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """太短的口令在入参就被拒。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    response = await client.post(
        f"{INSTANCES}/{instance_id}/credentials",
        json={"username": "scada03", "password": "short"},
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.status_code == BAD_REQUEST


@pytest.mark.usefixtures("clean_tables")
async def test_credentials_require_manage(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """凭据面归 `opcua:manage`——它决定谁能连上这台服务器。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    response = await client.get(
        f"{INSTANCES}/{instance_id}/credentials",
        headers=sign_headers(PERM_VIEW, PERM_OPERATE),
    )
    assert response.status_code == FORBIDDEN


@pytest.mark.usefixtures("clean_tables")
async def test_credential_can_be_deleted(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """删凭据返回 204。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    created = await client.post(
        f"{INSTANCES}/{instance_id}/credentials",
        json={"username": "gone"},
        headers=sign_headers(PERM_MANAGE),
    )
    credential_id = created.json()["data"]["credential"]["id"]
    response = await client.delete(
        f"{INSTANCES}/{instance_id}/credentials/{credential_id}",
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.status_code == NO_CONTENT


@pytest.mark.usefixtures("clean_tables")
async def test_deleting_unknown_credential_is_404(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """删不存在的凭据是 404，带真错误码。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    unknown = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
    response = await client.delete(
        f"{INSTANCES}/{instance_id}/credentials/{unknown}",
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.status_code == NOT_FOUND
    assert response.json()["code"] == 42111


@pytest.mark.usefixtures("clean_tables")
async def test_certificate_is_registered_by_fingerprint(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """登记证书后按指纹可查，主体也解析出来了。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    cert_pem, _ = _self_signed_pem()
    created = await client.post(
        f"{INSTANCES}/{instance_id}/trusted-certificates",
        json={"certificate_pem": cert_pem},
        headers=sign_headers(PERM_MANAGE),
    )
    assert created.status_code == CREATED
    body = created.json()["data"]
    assert len(body["fingerprint"]) == 64
    assert "test-scada" in body["subject"]


@pytest.mark.usefixtures("clean_tables")
async def test_certificate_with_a_private_key_is_rejected(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """输入里带私钥一律拒绝（不变式 7）。

    ⚠ 私钥进库意味着它会随数据库备份跑到任何存备份的地方。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    cert_pem, key_pem = _self_signed_pem()
    response = await client.post(
        f"{INSTANCES}/{instance_id}/trusted-certificates",
        json={"certificate_pem": cert_pem + key_pem},
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.status_code == BAD_REQUEST
    assert response.json()["code"] == 42112


@pytest.mark.usefixtures("clean_tables")
async def test_unparseable_certificate_is_rejected(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """乱码 PEM 报 400 而不是 500。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    response = await client.post(
        f"{INSTANCES}/{instance_id}/trusted-certificates",
        json={"certificate_pem": "-----BEGIN CERTIFICATE-----\nnope\n"},
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.status_code == BAD_REQUEST


@pytest.mark.usefixtures("clean_tables")
async def test_certificate_can_be_revoked(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """撤销证书返回 204，列表随之变空。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    cert_pem, _ = _self_signed_pem()
    created = await client.post(
        f"{INSTANCES}/{instance_id}/trusted-certificates",
        json={"certificate_pem": cert_pem},
        headers=sign_headers(PERM_MANAGE),
    )
    certificate_id = created.json()["data"]["id"]
    revoked = await client.delete(
        f"{INSTANCES}/{instance_id}/trusted-certificates/{certificate_id}",
        headers=sign_headers(PERM_MANAGE),
    )
    assert revoked.status_code == NO_CONTENT
    listed = await client.get(
        f"{INSTANCES}/{instance_id}/trusted-certificates",
        headers=sign_headers(PERM_MANAGE),
    )
    assert listed.json()["data"] == []


@pytest.mark.usefixtures("clean_tables")
async def test_security_endpoints_reject_unknown_instance(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """实例不存在时三条子资源都报 404。

    Args: client, sign_headers。
    """
    unknown = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
    for suffix, headers in (
        ("sessions", sign_headers(PERM_VIEW)),
        ("credentials", sign_headers(PERM_MANAGE)),
        ("trusted-certificates", sign_headers(PERM_MANAGE)),
    ):
        response = await client.get(
            f"{INSTANCES}/{unknown}/{suffix}", headers=headers
        )
        assert response.status_code == NOT_FOUND, suffix
