"""HTTP 精确目标授权、DNS 固定、元数据拒绝与请求配置传输。"""

import asyncio
import ipaddress
import socket
from dataclasses import replace

import pytest

from collector_server.apps.collect.drivers.base import DriverNotConnected
from collector_server.apps.collect.drivers.http.errors import (
    HttpConfigurationInvalid,
    HttpRequestFailed,
)
from collector_server.apps.collect.drivers.http.target import resolve_target
from unit.http_driver_fakes import (
    ENDPOINT,
    NOW_MS,
    SECRET,
    TOKEN_ENDPOINT,
    USER,
    HttpSetup,
    RecordingHandler,
    driver_for,
)


@pytest.mark.parametrize(
    "setup",
    [
        HttpSetup(is_enabled=False),
        HttpSetup(allowed_endpoints=frozenset()),
        HttpSetup(allowed_endpoints=frozenset({"http://127.0.0.1:1808"})),
        HttpSetup(allowed_endpoints=frozenset({"http://127.0.0.1:18080.evil"})),
        HttpSetup(endpoint="http://user:password@127.0.0.1:18080/data"),
        HttpSetup(
            endpoint="http://169.254.169.254/latest/meta-data",
            allowed_endpoints=frozenset({"http://169.254.169.254"}),
        ),
        HttpSetup(
            options={
                "auth_type": "oauth2_client_credentials",
                "token_endpoint": TOKEN_ENDPOINT,
            },
            username=USER,
            password=SECRET,
            allowed_endpoints=frozenset({"http://127.0.0.1:18080"}),
        ),
    ],
    ids=[
        "disabled",
        "empty-allowlist",
        "wrong-port",
        "lookalike-origin",
        "url-credentials",
        "metadata",
        "oauth-origin-not-allowed",
    ],
)
async def test_unapproved_targets_are_blocked_before_any_outbound_request(
    setup: HttpSetup,
) -> None:
    handler = RecordingHandler()
    driver = driver_for(handler, setup)
    with pytest.raises(HttpConfigurationInvalid):
        await driver.connect()
    assert handler.requests == []


async def test_default_port_in_an_allowed_origin_is_normalized() -> None:
    handler = RecordingHandler()
    driver = driver_for(
        handler,
        HttpSetup(
            endpoint="http://127.0.0.1/data",
            allowed_endpoints=frozenset({"http://127.0.0.1:80"}),
        ),
    )
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(21.5, NOW_MS, "good")]
    finally:
        await driver.disconnect()


@pytest.mark.parametrize(
    ("endpoint", "origin"),
    [
        ("http://192.168.10.20:18080/data", "http://192.168.10.20:18080"),
        ("http://[fd00:1234::20]:18080/data", "http://[fd00:1234::20]:18080"),
        (
            "http://[fd00:1234::20%1]:18080/data",
            "http://[fd00:1234::20%1]:18080",
        ),
    ],
    ids=["private-ipv4", "private-ipv6", "scoped-private-ipv6"],
)
async def test_authorized_private_targets_remain_collectable(
    endpoint: str, origin: str
) -> None:
    handler = RecordingHandler()
    driver = driver_for(
        handler,
        HttpSetup(endpoint=endpoint, allowed_endpoints=frozenset({origin})),
    )
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(21.5, NOW_MS, "good")]
        assert len(handler.requests) == 1
    finally:
        await driver.disconnect()


@pytest.mark.parametrize(
    "address",
    [
        "169.254.169.254",
        "224.0.0.1",
        "0.0.0.0",  # noqa: S104  # 被拒绝的目标样例
        "fe80::1",
        "ff02::1",
        "::",
        "::ffff:169.254.169.254",
        "100.100.100.200",
        "::ffff:100.100.100.200",
        "fd00:ec2::254",
        "fd00:ec2::254%1",
        "fd00:ec2::254%eth0",
        "fd00:ec2::254%25eth0",
    ],
)
async def test_dns_cannot_resolve_to_metadata_or_nonunicast(
    address: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def addresses(*_: object, **__: object):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 18080))]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", addresses)
    with pytest.raises(HttpConfigurationInvalid):
        await resolve_target("http://device.test:18080/data")


@pytest.mark.parametrize("scope", ["1", "eth0", "25eth0"])
async def test_scoped_metadata_literals_are_rejected_before_resolution(
    scope: str,
) -> None:
    with pytest.raises(HttpConfigurationInvalid):
        await resolve_target(
            f"http://[fd00:ec2::254%{scope}]/latest/meta-data/"
        )


async def test_any_forbidden_address_in_a_dns_answer_rejects_the_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def addresses(*_: object, **__: object):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 18080)),
            (
                socket.AF_INET,
                socket.SOCK_STREAM,
                6,
                "",
                ("169.254.169.254", 18080),
            ),
        ]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", addresses)
    with pytest.raises(HttpConfigurationInvalid):
        await resolve_target("http://device.test:18080/data")


@pytest.mark.parametrize("records", [[], OSError("dns-sensitive-text")])
async def test_empty_or_failed_dns_is_a_safe_transient_failure(
    records: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def addresses(*_: object, **__: object):
        if isinstance(records, Exception):
            raise records
        return records

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", addresses)
    with pytest.raises(HttpRequestFailed) as caught:
        await resolve_target("http://device.test:18080/data")
    assert "dns-sensitive-text" not in str(caught.value)


async def test_dns_is_resolved_once_and_request_keeps_original_host_and_sni(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[object, ...]] = []

    async def addresses(*args: object, **_: object):
        calls.append(args)
        ip = "127.0.0.1" if len(calls) == 1 else "169.254.169.254"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 18080))]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", addresses)
    handler = RecordingHandler()
    driver = driver_for(
        handler,
        HttpSetup(
            endpoint="https://device.test:18080/data",
            allowed_endpoints=frozenset({"https://device.test:18080"}),
        ),
    )
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(21.5, NOW_MS, "good")]
        assert len(calls) == 1
        assert handler.requests[0].url.host == "127.0.0.1"
        assert handler.requests[0].headers["Host"] == "device.test:18080"
        assert handler.requests[0].extensions["sni_hostname"] == "device.test"
    finally:
        await driver.disconnect()


async def test_ipv6_literal_and_mapped_loopback_are_pinned_without_dns() -> (
    None
):
    ipv6 = await resolve_target("http://[::1]:18080/data")
    mapped = await resolve_target("http://[::ffff:127.0.0.1]:18080/data")
    assert ipv6.url.host == "::1"
    assert ipv6.host == "[::1]:18080"
    assert ipaddress.ip_address(mapped.url.host) == ipaddress.IPv6Address(
        "::ffff:127.0.0.1"
    )


async def test_endpoint_query_and_configured_query_are_both_sent() -> None:
    handler = RecordingHandler()
    setup = HttpSetup(
        endpoint=ENDPOINT + "?existing=1",
        options={"query_json": '{"extra":"2"}'},
    )
    driver = driver_for(handler, setup)
    await driver.connect()
    try:
        assert (await driver.read_many(["value"]))[0][2] == "good"
        assert dict(handler.requests[0].url.params) == {
            "existing": "1",
            "extra": "2",
        }
    finally:
        await driver.disconnect()


async def test_post_query_body_and_public_headers_are_sent() -> None:
    handler = RecordingHandler()
    setup = HttpSetup(
        options={
            "method": "POST",
            "body_json": '{"meters":[1,2]}',
            "headers_json": '{"X-Site":"test-site"}',
            "query_json": '{"format":"json"}',
        }
    )
    driver = driver_for(handler, setup)
    await driver.connect()
    try:
        assert (await driver.read_many(["value"]))[0][2] == "good"
        request = handler.requests[0]
        assert request.method == "POST"
        assert request.content == b'{"meters":[1,2]}'
        assert request.headers["Content-Type"] == "application/json"
        assert request.headers["X-Site"] == "test-site"
        assert request.url.params["format"] == "json"
    finally:
        await driver.disconnect()


async def test_fingerprint_is_independent_of_option_insertion_order() -> None:
    setup = HttpSetup(options={"method": "GET", "timeout_s": "3"})
    other = replace(setup, options={"timeout_s": "3", "method": "GET"})
    assert (
        driver_for(RecordingHandler(), setup).fingerprint()
        == driver_for(RecordingHandler(), other).fingerprint()
    )


async def test_revoke_during_dns_cancels_before_sending_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = asyncio.Event()

    async def addresses(*_: object, **__: object):
        started.set()
        await asyncio.Event().wait()
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 18080))
        ]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", addresses)
    handler = RecordingHandler()
    driver = driver_for(
        handler,
        HttpSetup(
            endpoint="http://device.test:18080/data",
            allowed_endpoints=frozenset({"http://device.test:18080"}),
        ),
    )
    await driver.connect()
    task = asyncio.create_task(driver.read_many(["value"]))
    try:
        await started.wait()
        driver.revoke()
        with pytest.raises(DriverNotConnected):
            await task
        assert handler.requests == []
    finally:
        await driver.disconnect()
