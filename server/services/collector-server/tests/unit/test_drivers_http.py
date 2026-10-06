"""HTTP 驱动的逐点解析、对齐、错误分档与响应资源限制。"""

import asyncio
from dataclasses import replace

import httpx
import pytest

from collector_server.apps.collect.drivers.base import (
    BrowseNotSupported,
    DriverNotConnected,
    WriteNotSupported,
)
from collector_server.apps.collect.drivers.http.errors import (
    HttpAuthenticationRejected,
    HttpConfigurationInvalid,
    HttpRequestFailed,
    HttpResponseInvalid,
)
from collectwire import DataType
from unit.http_driver_fakes import (
    NOW_MS,
    SECRET,
    ChunkedBody,
    GatedHandler,
    HttpSetup,
    RecordingHandler,
    driver_for,
    point,
)


@pytest.mark.parametrize(
    ("value", "kind", "expected"),
    [
        (True, "bool", True),
        (0, "bool", False),
        (1, "bool", True),
        ("0", "bool", False),
        ("1", "bool", True),
        ("TRUE", "bool", True),
        ("false", "bool", False),
        (7, "int", 7),
        ("-7", "int", -7),
        ("+7", "int", 7),
        (21.5, "float", 21.5),
        ("21.5", "float", 21.5),
        (0, "float", 0.0),
        ("运行", "string", "运行"),
        (False, None, False),
        (7, None, 7),
        ("自动", None, "自动"),
        (21.5, None, 21.5),
    ],
)
async def test_declared_scalar_types_are_converted(
    value: object, kind: DataType | None, expected: object
) -> None:
    driver = driver_for(lambda _: httpx.Response(200, json={"value": value}))
    driver.load_points([point(kind=kind)])
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(expected, NOW_MS, "good")]
    finally:
        await driver.disconnect()


@pytest.mark.parametrize(
    ("value", "kind"),
    [
        (None, "float"),
        ({}, "string"),
        ([], "float"),
        (True, "int"),
        (True, "float"),
        (1.5, "int"),
        ("1.5", "int"),
        ("value", "float"),
        ("NaN", "float"),
        ("Infinity", "float"),
        ("1e309", "float"),
        (2, "bool"),
        ("yes", "bool"),
        (21.5, "string"),
    ],
)
async def test_invalid_or_missing_scalar_is_bad_without_stopping_siblings(
    value: object, kind: DataType | None
) -> None:
    driver = driver_for(
        lambda _: httpx.Response(200, json={"value": value, "ok": 12})
    )
    driver.load_points([point(kind=kind), point("ok", "/ok", "int")])
    await driver.connect()
    try:
        assert await driver.read_many(["value", "ok"]) == [
            (None, NOW_MS, "bad"),
            (12, NOW_MS, "good"),
        ]
        await driver.healthcheck()
    finally:
        await driver.disconnect()


async def test_pointer_escape_array_root_and_input_order_are_preserved() -> (
    None
):
    handler = RecordingHandler(
        [httpx.Response(200, json={"a/b": {"~key": [21.5]}, "flag": True})]
    )
    driver = driver_for(handler)
    driver.load_points(
        [
            point("temp", "/a~1b/~0key/0"),
            point("flag", "/flag", "bool"),
            point("root", "$", "string"),
            point("bad-index", "/a~1b/~0key/01"),
        ]
    )
    await driver.connect()
    try:
        assert await driver.read_many(
            ["flag", "unknown", "temp", "temp", "root", "bad-index"]
        ) == [
            (True, NOW_MS, "good"),
            (None, NOW_MS, "bad"),
            (21.5, NOW_MS, "good"),
            (21.5, NOW_MS, "good"),
            (None, NOW_MS, "bad"),
            (None, NOW_MS, "bad"),
        ]
        assert len(handler.requests) == 1
    finally:
        await driver.disconnect()


@pytest.mark.parametrize("value", [21.5, 0, -7])
async def test_root_scalar_is_a_point(value: float) -> None:
    driver = driver_for(lambda _: httpx.Response(200, json=value))
    driver.load_points([point(address="$")])
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(value, NOW_MS, "good")]
    finally:
        await driver.disconnect()


@pytest.mark.parametrize(
    "address", ["/absent", "/items/3", "/items/-1", "/items/-", "/value/child"]
)
async def test_unresolved_pointer_is_bad(address: str) -> None:
    driver = driver_for(
        lambda _: httpx.Response(200, json={"items": [3], "value": 1})
    )
    driver.load_points([point(address=address)])
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
    finally:
        await driver.disconnect()


async def test_empty_unknown_and_unloaded_points_make_no_request() -> None:
    handler = RecordingHandler()
    driver = driver_for(handler)
    assert (
        driver.load_points([point(address="bad-path"), point("bad", "/bad~2")])
        == 0
    )
    assert (
        await driver.read_many(["value", "unknown"])
        == [(None, NOW_MS, "bad")] * 2
    )
    assert handler.requests == []


@pytest.mark.parametrize(
    ("status", "error_type", "category"),
    [
        (401, HttpAuthenticationRejected, "auth"),
        (403, HttpAuthenticationRejected, "auth"),
        (429, HttpRequestFailed, "transient"),
        (500, HttpRequestFailed, "transient"),
        (503, HttpRequestFailed, "transient"),
        (301, HttpConfigurationInvalid, "config"),
        (302, HttpConfigurationInvalid, "config"),
        (307, HttpConfigurationInvalid, "config"),
        (400, HttpConfigurationInvalid, "config"),
        (404, HttpConfigurationInvalid, "config"),
    ],
)
async def test_request_errors_are_bad_classified_and_never_retried(
    status: int, error_type: type[Exception], category: str
) -> None:
    handler = RecordingHandler(
        [
            httpx.Response(
                status,
                headers={"Location": "http://169.254.169.254/latest/meta-data"},
                text=SECRET,
            )
        ]
    )
    driver = driver_for(handler)
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
        with pytest.raises(error_type) as caught:
            await driver.healthcheck()
        assert driver.classify_error(caught.value) == category
        assert SECRET not in str(caught.value)
        assert len(handler.requests) == 1
    finally:
        await driver.disconnect()


@pytest.mark.parametrize(
    "payload",
    [b"not-json", b"\xff", b'{"value":1} trailing', b"{", b'"unterminated'],
)
async def test_malformed_response_closes_and_marks_the_source_invalid(
    payload: bytes,
) -> None:
    stream = ChunkedBody((payload,))
    driver = driver_for(lambda _: httpx.Response(200, stream=stream))
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
        with pytest.raises(HttpResponseInvalid):
            await driver.healthcheck()
        assert stream.is_closed is True
    finally:
        await driver.disconnect()


@pytest.mark.parametrize("encoding", ["gzip", "deflate", "br"])
async def test_compressed_response_is_refused(encoding: str) -> None:
    driver = driver_for(
        lambda _: httpx.Response(
            200,
            headers={"Content-Encoding": encoding},
            stream=ChunkedBody((b"{}",)),
        )
    )
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
        with pytest.raises(HttpResponseInvalid):
            await driver.healthcheck()
    finally:
        await driver.disconnect()


async def test_streamed_response_cannot_exceed_its_size_budget() -> None:
    stream = ChunkedBody((b'{"value":', b"1", b"}"))
    driver = driver_for(
        lambda _: httpx.Response(200, stream=stream),
        HttpSetup(options={"max_response_bytes": "10"}),
    )
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
        with pytest.raises(HttpResponseInvalid, match="大小上限"):
            await driver.healthcheck()
        assert stream.is_closed is True
    finally:
        await driver.disconnect()


@pytest.mark.parametrize(
    "error_type",
    [httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError, OSError],
)
async def test_transport_failures_do_not_expose_upstream_text(
    error_type: type[Exception], caplog: pytest.LogCaptureFixture
) -> None:
    def fail(_: httpx.Request) -> httpx.Response:
        raise error_type(SECRET)

    driver = driver_for(fail)
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
        with pytest.raises(HttpRequestFailed) as caught:
            await driver.healthcheck()
        assert SECRET not in str(caught.value)
        assert SECRET not in caplog.text
    finally:
        await driver.disconnect()


async def test_error_is_cleared_after_a_successful_response() -> None:
    handler = RecordingHandler(
        [httpx.Response(503), httpx.Response(200, json={"value": 21.5})]
    )
    driver = driver_for(handler)
    await driver.connect()
    try:
        assert (await driver.read_many(["value"]))[0][2] == "bad"
        assert await driver.read_many(["value"]) == [(21.5, NOW_MS, "good")]
        await driver.healthcheck()
    finally:
        await driver.disconnect()


async def test_timeout_cancels_the_underlying_request() -> None:
    handler = GatedHandler()
    driver = driver_for(handler, HttpSetup(options={"timeout_s": "0.01"}))
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
        assert handler.cancelled.is_set() is True
        assert handler.active == 0
        with pytest.raises(HttpRequestFailed):
            await driver.healthcheck()
    finally:
        await driver.disconnect()


async def test_caller_cancellation_is_preserved() -> None:
    handler = GatedHandler()
    driver = driver_for(handler)
    await driver.connect()
    task = asyncio.create_task(driver.read_many(["value"]))
    try:
        await handler.entered.get()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert handler.cancelled.is_set() is True
        assert handler.active == 0
    finally:
        await driver.disconnect()


async def test_lifecycle_and_read_only_operations_are_explicit() -> None:
    driver = driver_for(RecordingHandler())
    with pytest.raises(DriverNotConnected):
        await driver.read_many(["value"])
    await driver.connect()
    await driver.connect()
    await driver.healthcheck()
    with pytest.raises(BrowseNotSupported):
        await driver.browse(None)
    with pytest.raises(BrowseNotSupported):
        await driver.subscribe([point()], lambda *_: None)
    with pytest.raises(WriteNotSupported):
        await driver.write("value", 1)
    assert await driver.unsubscribe(["value"]) == 0
    await driver.disconnect()
    await driver.disconnect()
    with pytest.raises(DriverNotConnected):
        await driver.healthcheck()


def test_fingerprint_is_secret_safe_and_detects_changes() -> None:
    setup = HttpSetup(options={"auth_type": "bearer"}, password=SECRET)
    first = driver_for(RecordingHandler(), setup).fingerprint()
    second = driver_for(
        RecordingHandler(), replace(setup, password="rotated-secret")
    ).fingerprint()
    third = driver_for(
        RecordingHandler(),
        replace(setup, options={"auth_type": "bearer", "timeout_s": "3"}),
    ).fingerprint()
    assert SECRET not in str(first)
    assert len(first[0]) == 64
    assert first != second
    assert first != third
    assert (
        driver_for(RecordingHandler()).classify_error(ValueError("bad"))
        == "config"
    )


async def test_empty_point_read_is_a_real_connectivity_probe() -> None:
    handler = RecordingHandler()
    driver = driver_for(handler)
    await driver.connect()
    try:
        assert await driver.read_many([]) == []
        assert len(handler.requests) == 1
    finally:
        await driver.disconnect()


@pytest.mark.parametrize("status", [401, 404, 503])
async def test_connectivity_probe_propagates_upstream_failure(
    status: int,
) -> None:
    driver = driver_for(RecordingHandler([httpx.Response(status)]))
    await driver.connect()
    try:
        with pytest.raises(
            (
                HttpAuthenticationRejected,
                HttpConfigurationInvalid,
                HttpRequestFailed,
            )
        ):
            await driver.read_many([])
    finally:
        await driver.disconnect()


@pytest.mark.parametrize("status", [401, 403, 404])
async def test_permanent_failure_blocks_further_polling_requests(
    status: int,
) -> None:
    handler = RecordingHandler([httpx.Response(status)])
    driver = driver_for(handler)
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
        assert len(handler.requests) == 1
    finally:
        await driver.disconnect()


@pytest.mark.parametrize(
    ("value", "kind", "expected", "quality"),
    [
        (9007199254740991, "int", 9007199254740991, "good"),
        (-9007199254740991, "int", -9007199254740991, "good"),
        (9007199254740992, "int", None, "bad"),
        (-9007199254740992, "int", None, "bad"),
        ("9007199254740993", "int", None, "bad"),
        (9007199254740993, "string", "9007199254740993", "good"),
    ],
)
async def test_large_integer_precision_uses_explicit_string_points(
    value: object, kind: DataType, expected: object, quality: str
) -> None:
    driver = driver_for(lambda _: httpx.Response(200, json={"value": value}))
    driver.load_points([point(kind=kind)])
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [
            (expected, NOW_MS, quality)
        ]
    finally:
        await driver.disconnect()


async def test_ten_thousand_points_share_one_http_response() -> None:
    handler = RecordingHandler(
        [httpx.Response(200, json={"values": list(range(10_000))})]
    )
    driver = driver_for(handler)
    codes = [f"value_{index}" for index in range(10_000)]
    assert (
        driver.load_points(
            [
                point(code, f"/values/{index}", "int")
                for index, code in enumerate(codes)
            ]
        )
        == 10_000
    )
    await driver.connect()
    try:
        samples = await asyncio.wait_for(driver.read_many(codes), timeout=5)
        assert len(samples) == 10_000
        assert samples[0] == (0, NOW_MS, "good")
        assert samples[-1] == (9999, NOW_MS, "good")
        assert len(handler.requests) == 1
    finally:
        await driver.disconnect()


async def test_buffered_response_cannot_exceed_its_size_budget() -> None:
    handler = RecordingHandler([httpx.Response(200, json={"value": "x" * 100})])
    driver = driver_for(
        handler, HttpSetup(options={"max_response_bytes": "32"})
    )
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
        with pytest.raises(HttpResponseInvalid, match="大小上限"):
            await driver.healthcheck()
    finally:
        await driver.disconnect()


async def test_revoked_driver_never_opens_a_fresh_network_request() -> None:
    handler = RecordingHandler()
    driver = driver_for(handler)
    await driver.connect()
    driver.revoke()
    try:
        with pytest.raises(DriverNotConnected):
            await driver.read_many(["value"])
        assert handler.requests == []
    finally:
        await driver.disconnect()


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
async def test_nonfinite_json_response_marks_the_whole_round_bad(
    literal: str,
) -> None:
    payload = '{"value":' + literal + ',"ok":12}'
    driver = driver_for(lambda _: httpx.Response(200, content=payload))
    driver.load_points([point(), point("ok", "/ok", "int")])
    await driver.connect()
    try:
        assert (
            await driver.read_many(["value", "ok"])
            == [(None, NOW_MS, "bad")] * 2
        )
        with pytest.raises(HttpResponseInvalid, match="非有限"):
            await driver.healthcheck()
    finally:
        await driver.disconnect()


@pytest.mark.parametrize("shape", ["object", "array"])
@pytest.mark.parametrize("depth", [64, 65])
async def test_response_json_depth_has_an_exact_boundary(
    shape: str, depth: int
) -> None:
    document: object = 21.5
    for _ in range(depth):
        document = {"value": document} if shape == "object" else [document]
    driver = driver_for(lambda _: httpx.Response(200, json=document))
    await driver.connect()
    try:
        if depth == 64:
            assert await driver.read_many([]) == []
        else:
            with pytest.raises(HttpResponseInvalid, match="深度上限"):
                await driver.read_many([])
    finally:
        await driver.disconnect()
