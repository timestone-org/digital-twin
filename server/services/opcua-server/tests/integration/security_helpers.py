"""OPC UA 身份验收使用的实例和临时证书。"""

from __future__ import annotations

import datetime as dt
from collections.abc import Callable
from typing import TYPE_CHECKING, Final

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from opcua_server.apps.instance.deps import PERM_MANAGE
from opcua_server.settings import API_PREFIX

if TYPE_CHECKING:
    import httpx

INSTANCES: Final[str] = f"{API_PREFIX}/instances"
RSA_BITS: Final[int] = 2048
Headers = Callable[..., dict[str, str]]


def certificate_pair() -> tuple[str, str]:
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


async def create_security_instance(
    client: httpx.AsyncClient, headers: Headers
) -> str:
    response = await client.post(
        INSTANCES,
        json={
            "name": "sec-host",
            "namespace_uri": "urn:test:sec",
            "security_policies": ["Basic256Sha256_SignAndEncrypt"],
        },
        headers=headers(PERM_MANAGE),
    )
    assert response.status_code == 201
    return str(response.json()["data"]["id"])
