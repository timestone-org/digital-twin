"""实例身份登记、校验与撤销的 PostgreSQL 契约。"""

from __future__ import annotations

import asyncio
import threading
from datetime import timedelta
from typing import TYPE_CHECKING
from uuid import UUID

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import serialization

from integration.security_helpers import (
    INSTANCES,
    certificate_pair,
    create_security_instance,
)
from lib.auth import PasswordHasher
from lib.testing import FrozenClock
from lib.utils.timeutils import utcnow
from opcua_server.apps.instance.crud import (
    credential_crud,
    trusted_certificate_crud,
)
from opcua_server.apps.instance.deps import PERM_MANAGE
from opcua_server.apps.instance.services.identity_directory import (
    InstanceIdentityDirectory,
)

if TYPE_CHECKING:
    import httpx
    from sqlalchemy.ext.asyncio import AsyncSession

    from integration.security_helpers import Headers
    from lib.db import Database
    from opcua_server.apps.instance.models import TrustedCertificate

pytestmark = [
    pytest.mark.requires_postgres,
    pytest.mark.usefixtures("clean_tables"),
]


async def test_registered_account_is_scoped_and_revocation_is_immediate(
    client: httpx.AsyncClient, sign_headers: Headers, database: Database
) -> None:
    instance_id = UUID(await create_security_instance(client, sign_headers))
    headers = sign_headers(PERM_MANAGE)
    route = f"{INSTANCES}/{instance_id}/credentials"
    created = await client.post(
        route, json={"username": "reader01"}, headers=headers
    )
    assert created.status_code == 201
    issued = created.json()["data"]
    directory = InstanceIdentityDirectory(database, PasswordHasher())
    assert await directory.accepts_password(
        instance_id, "reader01", issued["password"]
    )
    assert not await directory.accepts_password(
        instance_id, "reader01", "different"
    )
    assert not await directory.accepts_password(
        UUID(int=1), "reader01", issued["password"]
    )
    removed = await client.delete(
        f"{route}/{issued['credential']['id']}", headers=headers
    )
    assert removed.status_code == 204
    assert not await directory.accepts_password(
        instance_id, "reader01", issued["password"]
    )


async def test_registered_certificate_checks_validity_instance_and_revocation(
    client: httpx.AsyncClient, sign_headers: Headers, database: Database
) -> None:
    instance_id = UUID(await create_security_instance(client, sign_headers))
    pem, _ = certificate_pair()
    cert = x509.load_pem_x509_certificate(pem.encode())
    der = cert.public_bytes(serialization.Encoding.DER)
    route = f"{INSTANCES}/{instance_id}/trusted-certificates"
    headers = sign_headers(PERM_MANAGE)
    created = await client.post(
        route, json={"certificate_pem": pem}, headers=headers
    )
    assert created.status_code == 201
    directory = InstanceIdentityDirectory(database, PasswordHasher())
    assert (
        await directory.trusted_subject(instance_id, der)
        == cert.subject.rfc4514_string()
    )
    assert await directory.trusted_subject(UUID(int=1), der) is None
    assert await directory.trusted_subject(instance_id, b"invalid") is None
    for when in (utcnow() - timedelta(days=3), utcnow() + timedelta(days=367)):
        outside = InstanceIdentityDirectory(
            database, PasswordHasher(), clock=lambda now=when: now
        )
        assert await outside.trusted_subject(instance_id, der) is None
    removed = await client.delete(
        f"{route}/{created.json()['data']['id']}", headers=headers
    )
    assert removed.status_code == 204
    assert await directory.trusted_subject(instance_id, der) is None


class PausedVerification(PasswordHasher):
    """让用例能在 Argon2 计算期间撤销凭据。"""

    def __init__(self) -> None:
        super().__init__()
        self.started = asyncio.Event()
        self.release = threading.Event()
        self.loop = asyncio.get_running_loop()

    def verify(self, raw: str, hashed: str) -> bool:
        self.loop.call_soon_threadsafe(self.started.set)
        if not self.release.wait(5):
            raise RuntimeError("verification fixture did not resume")
        return super().verify(raw, hashed)


async def test_revocation_during_verification_wins(
    client: httpx.AsyncClient, sign_headers: Headers, database: Database
) -> None:
    instance_id = UUID(await create_security_instance(client, sign_headers))
    route = f"{INSTANCES}/{instance_id}/credentials"
    headers = sign_headers(PERM_MANAGE)
    created = await client.post(
        route, json={"username": "reader02"}, headers=headers
    )
    assert created.status_code == 201
    issued = created.json()["data"]
    hasher = PausedVerification()
    directory = InstanceIdentityDirectory(database, hasher)
    check = asyncio.create_task(
        directory.accepts_password(instance_id, "reader02", issued["password"])
    )
    try:
        async with asyncio.timeout(5):
            await hasher.started.wait()
            removed = await client.delete(
                f"{route}/{issued['credential']['id']}", headers=headers
            )
            assert removed.status_code == 204
    finally:
        hasher.release.set()
    assert not await check


async def test_unsupported_fields_are_rejected_before_lookup(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unexpected_lookup(*_args: object, **_kwargs: object) -> None:
        pytest.fail("非法身份字段触发了数据库查询")

    monkeypatch.setattr(credential_crud, "get_by_username", unexpected_lookup)
    directory = InstanceIdentityDirectory(database, PasswordHasher())
    assert not await directory.accepts_password(
        UUID(int=1), "", "local fixture"
    )
    assert not await directory.accepts_password(UUID(int=1), "reader", "")
    assert not await directory.accepts_password(
        UUID(int=1), "x" * 65, "local fixture"
    )
    assert not await directory.accepts_password(
        UUID(int=1), "reader", "x" * 129
    )


async def test_certificate_expiry_during_database_read_fails_closed(
    client: httpx.AsyncClient,
    sign_headers: Headers,
    database: Database,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    instance_id = UUID(await create_security_instance(client, sign_headers))
    pem, _ = certificate_pair()
    cert = x509.load_pem_x509_certificate(pem.encode())
    created = await client.post(
        f"{INSTANCES}/{instance_id}/trusted-certificates",
        json={"certificate_pem": pem},
        headers=sign_headers(PERM_MANAGE),
    )
    assert created.status_code == 201
    clock = FrozenClock(current=cert.not_valid_after_utc - timedelta(seconds=1))
    original = trusted_certificate_crud.get_by_fingerprint

    async def delayed(
        session: AsyncSession, *, instance_id: UUID, fingerprint: str
    ) -> TrustedCertificate | None:
        row = await original(
            session, instance_id=instance_id, fingerprint=fingerprint
        )
        clock.advance(1)
        return row

    monkeypatch.setattr(trusted_certificate_crud, "get_by_fingerprint", delayed)
    directory = InstanceIdentityDirectory(
        database, PasswordHasher(), clock=clock
    )
    assert (
        await directory.trusted_subject(
            instance_id, cert.public_bytes(serialization.Encoding.DER)
        )
        is None
    )


class HeldHashing(PasswordHasher):
    """在工作线程登记实际开始的 Argon2 操作，由用例释放。"""

    def __init__(self) -> None:
        super().__init__()
        self.started: asyncio.Queue[str] = asyncio.Queue()
        self.release = threading.Event()
        self.loop = asyncio.get_running_loop()

    def _hold(self, operation: str) -> None:
        self.loop.call_soon_threadsafe(self.started.put_nowait, operation)
        if not self.release.wait(5):
            raise RuntimeError("hash fixture did not resume")

    def hash(self, raw: str) -> str:
        self._hold("create")
        return super().hash(raw)

    def verify(self, raw: str, hashed: str) -> bool:
        self._hold("verify")
        return super().verify(raw, hashed)


async def test_cancelled_hashes_keep_capacity_until_native_work_finishes(
    client: httpx.AsyncClient, sign_headers: Headers, database: Database
) -> None:
    instance_id = UUID(await create_security_instance(client, sign_headers))
    created = await client.post(
        f"{INSTANCES}/{instance_id}/credentials",
        json={"username": "capacity-test"},
        headers=sign_headers(PERM_MANAGE),
    )
    assert created.status_code == 201
    password = created.json()["data"]["password"]
    hasher = HeldHashing()
    directory = InstanceIdentityDirectory(database, hasher)
    adding = asyncio.create_task(directory.hash_password(password))
    checking = asyncio.create_task(
        directory.accepts_password(instance_id, "capacity-test", password)
    )
    try:
        async with asyncio.timeout(5):
            assert {await hasher.started.get(), await hasher.started.get()} == {
                "create",
                "verify",
            }
        adding.cancel()
        checking.cancel()
        await asyncio.gather(adding, checking, return_exceptions=True)
        assert adding.cancelled()
        assert checking.cancelled()
        next_hash = asyncio.create_task(directory.hash_password(password))
        try:
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(hasher.started.get(), timeout=0.15)
        finally:
            hasher.release.set()
            result = await next_hash
        assert hasher.started.get_nowait() == "create"
        assert await asyncio.to_thread(
            PasswordHasher().verify, password, result
        )
    finally:
        hasher.release.set()
        await asyncio.gather(adding, checking, return_exceptions=True)
