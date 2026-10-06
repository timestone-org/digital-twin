"""六种 HTTP 认证、Digest 协商与 OAuth2 会话令牌生命周期。"""

import base64
import hashlib
import re
from dataclasses import replace
from urllib.parse import unquote_plus

import httpx
import pytest

from collector_server.apps.collect.drivers.http.errors import (
    HttpAuthenticationRejected,
    HttpConfigurationInvalid,
)
from unit.http_driver_fakes import (
    NOW_MS,
    SECRET,
    TOKEN_ENDPOINT,
    USER,
    ChunkedBody,
    Clock,
    HttpSetup,
    RecordingHandler,
    driver_for,
)


@pytest.mark.parametrize(
    ("kind", "username", "secret", "header", "expected"),
    [
        ("none", None, None, "Authorization", None),
        (
            "basic",
            USER,
            SECRET,
            "Authorization",
            "Basic dGVzdC11c2VyOmh0dHAtdGVzdC1jcmVkZW50aWFs",
        ),
        ("bearer", None, SECRET, "Authorization", f"Bearer {SECRET}"),
        ("api_key", None, SECRET, "X-API-Key", SECRET),
    ],
)
async def test_configured_authentication_is_sent_in_the_expected_header(
    kind: str,
    username: str | None,
    secret: str | None,
    header: str,
    expected: str | None,
) -> None:
    handler = RecordingHandler()
    driver = driver_for(
        handler,
        HttpSetup(
            options={"auth_type": kind}, username=username, password=secret
        ),
    )
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(21.5, NOW_MS, "good")]
        assert handler.requests[0].headers.get(header) == expected
        assert handler.requests[0].headers["Accept-Encoding"] == "identity"
    finally:
        await driver.disconnect()


async def test_api_key_can_use_a_configured_header_name() -> None:
    handler = RecordingHandler()
    driver = driver_for(
        handler,
        HttpSetup(
            options={"auth_type": "api_key", "auth_header": "X-Custom-Key"},
            password=SECRET,
        ),
    )
    await driver.connect()
    try:
        assert (await driver.read_many(["value"]))[0][2] == "good"
        assert handler.requests[0].headers["X-Custom-Key"] == SECRET
        assert "X-API-Key" not in handler.requests[0].headers
    finally:
        await driver.disconnect()


def _digest_fields(header: str) -> dict[str, str]:
    return {
        name: quoted or raw
        for name, quoted, raw in re.findall(
            r'(\w+)=(?:"([^"]*)"|([^,\s]+))', header
        )
    }


def _md5(value: str) -> str:
    return hashlib.md5(value.encode(), usedforsecurity=False).hexdigest()


async def test_digest_challenge_produces_a_valid_response() -> None:
    requests: list[httpx.Request] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.headers.get("Authorization") is None:
            return httpx.Response(
                401,
                headers={
                    "WWW-Authenticate": (
                        'Digest realm="collector", nonce="fixed-nonce", '
                        'algorithm=MD5, qop="auth"'
                    )
                },
            )
        fields = _digest_fields(request.headers["Authorization"])
        expected = _md5(
            ":".join(
                [
                    _md5(f"{USER}:collector:{SECRET}"),
                    "fixed-nonce",
                    fields["nc"],
                    fields["cnonce"],
                    "auth",
                    _md5(f"GET:{fields['uri']}"),
                ]
            )
        )
        assert fields["username"] == USER
        assert fields["uri"] == "/data"
        assert fields["response"] == expected
        return httpx.Response(200, json={"value": 21.5})

    driver = driver_for(
        upstream,
        HttpSetup(
            options={"auth_type": "digest"}, username=USER, password=SECRET
        ),
    )
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(21.5, NOW_MS, "good")]
        assert len(requests) == 2
    finally:
        await driver.disconnect()


def _oauth_setup() -> HttpSetup:
    return HttpSetup(
        options={
            "auth_type": "oauth2_client_credentials",
            "token_endpoint": TOKEN_ENDPOINT,
            "scope": "measurements:read",
        },
        username=USER,
        password=SECRET,
    )


@pytest.mark.parametrize(
    ("username", "secret"),
    [
        ("service:a", "A+ b"),
        ("client%id", "secret:+% /"),
        ("客户端", "测试密码"),
    ],
    ids=["colon-plus-space", "reserved-characters", "unicode"],
)
async def test_oauth_basic_credentials_are_form_encoded(
    username: str, secret: str
) -> None:
    def upstream(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            encoded = request.headers["Authorization"].removeprefix("Basic ")
            fields = base64.b64decode(encoded).decode().split(":", 1)
            if not all(field.isascii() for field in fields) or tuple(
                unquote_plus(field) for field in fields
            ) != (username, secret):
                return httpx.Response(401)
            return httpx.Response(
                200,
                json={"access_token": "test-token", "token_type": "Bearer"},
            )
        assert request.headers["Authorization"] == "Bearer test-token"
        return httpx.Response(200, json={"value": 21.5})

    driver = driver_for(
        upstream, replace(_oauth_setup(), username=username, password=secret)
    )
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(21.5, NOW_MS, "good")]
    finally:
        await driver.disconnect()


async def test_oauth_token_is_cached_refreshed_and_cleared_on_disconnect() -> (
    None
):
    clock = Clock()
    requests: list[httpx.Request] = []
    tokens: list[str] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/token":
            tokens.append(f"fake-token-{len(tokens)+1}")
            assert request.method == "POST"
            assert (
                request.headers["Authorization"]
                == "Basic dGVzdC11c2VyOmh0dHAtdGVzdC1jcmVkZW50aWFs"
            )
            assert (
                request.content
                == b"grant_type=client_credentials&scope=measurements%3Aread"
            )
            return httpx.Response(
                200,
                json={
                    "access_token": tokens[-1],
                    "token_type": "bEaReR",
                    "expires_in": 10,
                },
            )
        assert request.headers["Authorization"] == f"Bearer {tokens[-1]}"
        return httpx.Response(200, json={"value": 21.5})

    driver = driver_for(upstream, _oauth_setup(), clock)
    await driver.connect()
    try:
        assert (await driver.read_many(["value"]))[0][2] == "good"
        clock.now_s = 108.9
        assert (await driver.read_many(["value"]))[0][2] == "good"
        assert tokens == ["fake-token-1"]
        clock.now_s = 109
        assert (await driver.read_many(["value"]))[0][2] == "good"
        assert tokens == ["fake-token-1", "fake-token-2"]
        await driver.disconnect()
        await driver.connect()
        assert (await driver.read_many(["value"]))[0][2] == "good"
        assert tokens == ["fake-token-1", "fake-token-2", "fake-token-3"]
        assert len(requests) == 7
    finally:
        await driver.disconnect()


@pytest.mark.parametrize(
    "token",
    [
        {},
        {"access_token": SECRET, "token_type": "mac"},
        {"access_token": "", "token_type": "Bearer"},
        {"access_token": SECRET, "token_type": "Bearer", "expires_in": 0},
        {"access_token": SECRET + "\n", "token_type": "Bearer"},
    ],
)
async def test_invalid_oauth_token_never_reaches_the_data_endpoint(
    token: object, caplog: pytest.LogCaptureFixture
) -> None:
    handler = RecordingHandler([httpx.Response(200, json=token)])
    driver = driver_for(handler, _oauth_setup())
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
        with pytest.raises(HttpAuthenticationRejected) as caught:
            await driver.healthcheck()
        assert SECRET not in str(caught.value)
        assert SECRET not in repr(caught.value)
        assert SECRET not in caplog.text
        assert [request.url.path for request in handler.requests] == ["/token"]
    finally:
        await driver.disconnect()


async def test_oauth_without_scope_uses_only_the_client_credentials_grant() -> (
    None
):
    handler = RecordingHandler(
        [
            httpx.Response(
                200, json={"access_token": "fake", "token_type": "Bearer"}
            ),
            httpx.Response(200, json={"value": 21.5}),
        ]
    )
    setup = replace(
        _oauth_setup(),
        options={
            "auth_type": "oauth2_client_credentials",
            "token_endpoint": TOKEN_ENDPOINT,
        },
    )
    driver = driver_for(handler, setup)
    await driver.connect()
    try:
        assert (await driver.read_many(["value"]))[0][2] == "good"
        assert handler.requests[0].content == b"grant_type=client_credentials"
    finally:
        await driver.disconnect()


@pytest.mark.parametrize(
    ("options", "username", "password"),
    [
        ({"auth_type": "none"}, USER, None),
        ({"auth_type": "none"}, None, SECRET),
        ({"auth_type": "bearer"}, None, None),
        ({"auth_type": "basic"}, None, SECRET),
        ({"auth_type": "digest"}, None, SECRET),
        (
            {
                "auth_type": "oauth2_client_credentials",
                "token_endpoint": TOKEN_ENDPOINT,
            },
            None,
            SECRET,
        ),
        ({"auth_type": "bearer"}, None, "bad\nsecret"),
        ({"auth_type": "api_key"}, None, "中文"),
    ],
)
def test_incomplete_or_unsafe_credentials_are_rejected(
    options: dict[str, str], username: str | None, password: str | None
) -> None:
    with pytest.raises(HttpConfigurationInvalid):
        driver_for(
            RecordingHandler(),
            HttpSetup(options=options, username=username, password=password),
        )


def test_unknown_or_malformed_http_configuration_is_rejected() -> None:
    with pytest.raises(HttpConfigurationInvalid):
        driver_for(RecordingHandler(), HttpSetup(options={"unknown": "field"}))


async def test_digest_challenge_body_has_the_same_response_size_limit() -> None:
    stream = ChunkedBody((b"x" * 4096,))
    handler = RecordingHandler(
        [
            httpx.Response(
                401,
                headers={
                    "WWW-Authenticate": (
                        'Digest realm="collector", nonce="nonce", ' 'qop="auth"'
                    )
                },
                stream=stream,
            ),
            httpx.Response(200, json={"value": 21.5}),
        ]
    )
    driver = driver_for(
        handler,
        HttpSetup(
            options={"auth_type": "digest", "max_response_bytes": "32"},
            username=USER,
            password=SECRET,
        ),
    )
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
        assert stream.is_closed is True
        assert len(handler.requests) == 1
    finally:
        await driver.disconnect()
