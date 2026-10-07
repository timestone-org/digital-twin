"""HTTP 不接 Cookie 会话，Digest 挑战失败必须停止当前认证轮询。"""

import httpx
import pytest

from collector_server.apps.collect.drivers.http.errors import (
    HttpAuthenticationRejected,
)
from unit.http_driver_fakes import (
    NOW_MS,
    SECRET,
    TOKEN_ENDPOINT,
    USER,
    HttpSetup,
    RecordingHandler,
    driver_for,
)


@pytest.mark.parametrize(
    "challenge",
    [
        'Digest realm="test", nonce="nonce", algorithm=SHA-512-256, qop="auth"',
        'Digest realm="test", nonce="nonce", algorithm=MD5, qop="auth-int"',
        'Digest realm="test", malformed-field, nonce="nonce"',
        'Digest realm="test", qop="auth"',
        'Digest realm="test", nonce="nonce", qop="unsupported"',
    ],
    ids=["algorithm", "auth-int", "malformed", "missing-nonce", "qop"],
)
async def test_digest_challenge_failure_records_auth_error_and_stops_reads(
    challenge: str,
) -> None:
    handler = RecordingHandler(
        [httpx.Response(401, headers={"WWW-Authenticate": challenge})]
    )
    driver = driver_for(
        handler,
        HttpSetup(
            options={"auth_type": "digest"}, username=USER, password=SECRET
        ),
    )
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
        with pytest.raises(HttpAuthenticationRejected) as caught:
            await driver.healthcheck()
        assert driver.classify_error(caught.value) == "auth"
        assert SECRET not in str(caught.value)
        assert "nonce" not in str(caught.value)
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
        assert len(handler.requests) == 1
    finally:
        await driver.disconnect()


async def test_digest_challenge_cookie_is_never_forwarded() -> None:
    handler = RecordingHandler(
        [
            httpx.Response(
                401,
                headers={
                    "WWW-Authenticate": (
                        'Digest realm="test", nonce="nonce", qop="auth"'
                    ),
                    "Set-Cookie": "challenge=local-only-cookie; Path=/",
                },
            ),
            httpx.Response(200, json={"value": 21.5}),
        ]
    )
    driver = driver_for(
        handler,
        HttpSetup(
            options={"auth_type": "digest"}, username=USER, password=SECRET
        ),
    )
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(21.5, NOW_MS, "good")]
        assert len(handler.requests) == 2
        assert all(
            "Cookie" not in request.headers for request in handler.requests
        )
    finally:
        await driver.disconnect()


@pytest.mark.parametrize("kind", ["none", "oauth2_client_credentials"])
async def test_response_cookie_does_not_create_ambient_authentication(
    kind: str,
) -> None:
    options = {"auth_type": kind}
    if kind == "oauth2_client_credentials":
        options["token_endpoint"] = TOKEN_ENDPOINT
    token = httpx.Response(
        200,
        json={"access_token": "test-access-token", "token_type": "Bearer"},
        headers={"Set-Cookie": "token-session=local-only-cookie; Path=/"},
    )
    data = httpx.Response(
        200,
        json={"value": 21.5},
        headers={"Set-Cookie": "data-session=local-only-cookie; Path=/"},
    )
    handler = RecordingHandler([data] if kind == "none" else [token, data])
    driver = driver_for(
        handler,
        HttpSetup(
            options=options,
            username=None if kind == "none" else USER,
            password=None if kind == "none" else SECRET,
        ),
    )
    await driver.connect()
    try:
        for _ in range(3):
            assert await driver.read_many(["value"]) == [(21.5, NOW_MS, "good")]
        assert all(
            "Cookie" not in request.headers for request in handler.requests
        )
    finally:
        await driver.disconnect()
