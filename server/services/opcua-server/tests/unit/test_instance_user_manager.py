"""单次激活的用户身份与任务、会话和显式令牌绑定。"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Final
from uuid import UUID, uuid4

import pytest
from asyncua import ua
from asyncua.common.utils import Buffer, ServiceError
from asyncua.crypto.permission_rules import UserRole
from asyncua.ua.ua_binary import struct_to_binary

from opcua_server.apps.instance.runtime import identity_server
from opcua_server.apps.instance.runtime.identity import InstanceUserManager
from opcua_server.apps.instance.runtime.sessions import (
    SessionRegistry,
    TrackingInternalServer,
)

if TYPE_CHECKING:
    from opcua_server.apps.instance.runtime.sessions import TrackedSession

ACCOUNT: Final[str] = "machine-reader"
PASSPHRASE: Final[str] = "local test credential"


class Registered:
    def __init__(self, instance_id: UUID) -> None:
        self.instance_id = instance_id

    async def accepts_password(
        self, instance_id: UUID, username: str, password: str
    ) -> bool:
        return (
            instance_id == self.instance_id
            and username == ACCOUNT
            and password == PASSPHRASE
        )

    async def trusted_subject(
        self, instance_id: UUID, certificate: bytes
    ) -> str | None:
        return (
            "CN=Machine"
            if instance_id == self.instance_id and certificate == b"user-token"
            else None
        )


def fixture_session() -> (
    tuple[InstanceUserManager, TrackingInternalServer, TrackedSession]
):
    instance_id = uuid4()
    manager = InstanceUserManager(instance_id, Registered(instance_id))
    server = TrackingInternalServer(SessionRegistry(), manager)
    return manager, server, server.create_session("local-test", external=True)


def account_token(
    password: bytes = PASSPHRASE.encode(),
) -> ua.UserNameIdentityToken:
    return ua.UserNameIdentityToken(UserName=ACCOUNT, Password=password)


async def test_account_grant_is_single_use_on_its_session_and_task() -> None:
    manager, server, session = fixture_session()
    other = server.create_session("other-local-test", external=True)
    identity = await manager.prepare(session, account_token())

    async def inspect_child_task() -> None:
        assert manager.identity_for(session) is None
        assert manager.get_user(server, ACCOUNT, PASSPHRASE) is None

    with manager.grant(session, identity):
        assert manager.identity_for(session) is identity
        assert manager.identity_for(other) is None
        assert manager.get_user(object(), ACCOUNT, PASSPHRASE) is None
        child = asyncio.create_task(inspect_child_task())
        await child
        user = manager.get_user(server, ACCOUNT, PASSPHRASE)
        assert user is not None
        assert (user.name, user.role) == (None, UserRole.User)
        assert manager.get_user(server, ACCOUNT, PASSPHRASE) is None
    assert manager.identity_for(session) is None


@pytest.mark.parametrize(
    ("username", "password"),
    [("different", PASSPHRASE), (ACCOUNT, "other secret"), (ACCOUNT, None)],
)
async def test_account_grant_is_bound_to_the_verified_input(
    username: str, password: str | None
) -> None:
    manager, server, session = fixture_session()
    identity = await manager.prepare(session, account_token())
    with manager.grant(session, identity):
        assert manager.get_user(server, username, password) is None


async def test_explicit_anonymous_on_signed_channel_keeps_its_identity() -> (
    None
):
    manager, server, session = fixture_session()
    identity = await manager.prepare(session, ua.ExtensionObject())
    with manager.grant(session, identity):
        user = manager.get_user(server, certificate=b"channel-certificate")
        assert user is not None
        assert (user.name, user.role) == (None, UserRole.User)
    with manager.grant(session, identity):
        assert (
            manager.get_user(server, username=ACCOUNT, password=PASSPHRASE)
            is None
        )
    server.supported_tokens = (ua.UserNameIdentityToken,)
    with pytest.raises(ServiceError) as rejected:
        await manager.prepare(session, ua.AnonymousIdentityToken())
    assert rejected.value.code == ua.StatusCodes.BadIdentityTokenRejected


async def test_certificate_grant_is_bound_to_the_user_certificate() -> None:
    manager, server, session = fixture_session()
    token = ua.X509IdentityToken(CertificateData=b"user-token")
    identity = await manager.prepare(session, token)
    with manager.grant(session, identity):
        assert (
            manager.get_user(server, certificate=b"channel-certificate") is None
        )
    with manager.grant(session, identity):
        user = manager.get_user(server, certificate=b"user-token")
        assert user is not None
        assert (user.name, user.role) == (None, UserRole.User)


@pytest.mark.parametrize(
    "token",
    [
        account_token(b""),
        account_token(b"different"),
        ua.X509IdentityToken(CertificateData=b"missing"),
        ua.X509IdentityToken(),
        ua.IssuedIdentityToken(),
    ],
)
async def test_unverified_identity_creates_no_grant(token: object) -> None:
    manager, server, session = fixture_session()
    with pytest.raises(ServiceError):
        await manager.prepare(session, token)
    assert manager.get_user(server) is None


async def test_invalid_token_encoding_returns_an_identity_error() -> None:
    manager, _, session = fixture_session()
    with pytest.raises(ServiceError) as rejected:
        await manager.prepare(session, account_token(b"\xff"))
    assert rejected.value.code == ua.StatusCodes.BadIdentityTokenInvalid


async def test_missing_directory_fails_closed_for_named_identities() -> None:
    manager = InstanceUserManager()
    server = TrackingInternalServer(SessionRegistry(), manager)
    session = server.create_session("local-test", external=True)
    for token in (
        account_token(),
        ua.X509IdentityToken(CertificateData=b"user-token"),
    ):
        with pytest.raises(ServiceError) as rejected:
            await manager.prepare(session, token)
        assert rejected.value.code == ua.StatusCodes.BadUserAccessDenied


async def test_direct_activation_requires_its_own_verified_grant() -> None:
    manager, _, session = fixture_session()
    assert manager.identity_for(session) is None
    with pytest.raises(ServiceError) as rejected:
        session.activate_session(ua.ActivateSessionParameters(), None)
    assert rejected.value.code == ua.StatusCodes.BadUserAccessDenied


@pytest.mark.parametrize(
    ("failure", "status"),
    [
        (
            RuntimeError("directory unavailable"),
            ua.StatusCodes.BadResourceUnavailable,
        ),
        (TimeoutError(), ua.StatusCodes.BadTimeout),
        (
            ServiceError(ua.StatusCodes.BadUserAccessDenied),
            ua.StatusCodes.BadUserAccessDenied,
        ),
    ],
)
async def test_directory_failure_does_not_grant_a_session(
    failure: Exception, status: int
) -> None:
    class Unavailable(Registered):
        async def accepts_password(
            self, instance_id: UUID, username: str, password: str
        ) -> bool:
            assert instance_id == self.instance_id
            assert username == ACCOUNT
            assert password == PASSPHRASE
            raise failure

    instance_id = uuid4()
    manager = InstanceUserManager(instance_id, Unavailable(instance_id))
    server = TrackingInternalServer(SessionRegistry(), manager)
    session = server.create_session("local-test", external=True)
    params = ua.ActivateSessionParameters(UserIdentityToken=account_token())
    body = Buffer(struct_to_binary(params))
    with pytest.raises(ServiceError) as rejected:
        await identity_server._prepare(manager, session, body)
    assert rejected.value.code == status
    assert manager.identity_for(session) is None


async def test_unreadable_message_cannot_grant_an_identity() -> None:
    manager, _, session = fixture_session()
    with pytest.raises(ServiceError) as rejected:
        await identity_server._prepare(manager, session, Buffer(b""))
    assert rejected.value.code == ua.StatusCodes.BadIdentityTokenInvalid
    assert manager.identity_for(session) is None


@pytest.mark.parametrize("should_close", [False, True])
async def test_existing_session_keeps_the_upstream_state_error(
    should_close: bool,
) -> None:
    manager, _, session = fixture_session()
    if should_close:
        await session.close_session()
    else:
        token = account_token()
        verified = await manager.prepare(session, token)
        with manager.grant(session, verified):
            session.activate_session(
                ua.ActivateSessionParameters(UserIdentityToken=token), None
            )
    try:
        with pytest.raises(ServiceError) as rejected:
            session.activate_session(ua.ActivateSessionParameters(), None)
        assert rejected.value.code == ua.StatusCodes.BadSessionIdInvalid
    finally:
        await session.close_session()


async def test_session_display_name_stays_out_of_sdk_logs(
    caplog: pytest.LogCaptureFixture,
) -> None:
    manager, server, session = fixture_session()
    token = account_token()
    identity = await manager.prepare(session, token)
    sdk = logging.getLogger("asyncua.server.internal_session")
    sdk.addHandler(caplog.handler)
    try:
        with (
            caplog.at_level(logging.INFO, logger=sdk.name),
            manager.grant(session, identity),
        ):
            session.activate_session(
                ua.ActivateSessionParameters(UserIdentityToken=token), None
            )
        messages = [
            record.getMessage()
            for record in caplog.records
            if record.name == sdk.name
            and record.getMessage().startswith("Activated internal session")
        ]
        assert messages
        assert all(ACCOUNT not in message for message in messages)
        assert all(PASSPHRASE not in message for message in messages)
        assert [r.username for r in server.registry.records()] == [ACCOUNT]
    finally:
        sdk.removeHandler(caplog.handler)
        await session.close_session()


async def test_upstream_user_proof_failure_does_not_register_a_session() -> (
    None
):
    class RejectingProof(TrackingInternalServer):
        def verify_x509_token(self, *_args: object) -> bytes:
            raise ServiceError(ua.StatusCodes.BadUserSignatureInvalid)

    instance_id = uuid4()
    manager = InstanceUserManager(instance_id, Registered(instance_id))
    registry = SessionRegistry()
    server = RejectingProof(registry, manager)
    session = server.create_session("local-test", external=True)
    token = ua.X509IdentityToken(CertificateData=b"user-token")
    identity = await manager.prepare(session, token)
    with (
        manager.grant(session, identity),
        pytest.raises(ServiceError) as rejected,
    ):
        session.activate_session(
            ua.ActivateSessionParameters(UserIdentityToken=token), None
        )
    assert rejected.value.code == ua.StatusCodes.BadUserSignatureInvalid
    assert registry.records() == []
    assert manager.get_user(server) is None
