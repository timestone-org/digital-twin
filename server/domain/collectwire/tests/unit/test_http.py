"""HTTP 配置与点位路径拒绝秘密、未知配置和无效语法。"""

import pytest

from collectwire.http import (
    HttpOptions,
    validate_http_endpoint,
    validate_http_pointer,
)


def test_default_options() -> None:
    options = HttpOptions.from_options({})
    assert options.method == "GET"
    assert options.auth_type == "none"
    assert options.timeout_s == 5


@pytest.mark.parametrize("address", ["$", "/", "/data/0/value", "/a~1b/~0"])
def test_pointer_paths(address: str) -> None:
    validate_http_pointer(address)


@pytest.mark.parametrize("address", ["", "data.value", "/bad~2", "/bad~"])
def test_pointer_rejects_invalid_syntax(address: str) -> None:
    with pytest.raises(ValueError, match="HTTP 点位"):
        validate_http_pointer(address)


@pytest.mark.parametrize(
    "endpoint",
    [
        "file:///etc/passwd",
        "http://user:secret@host/a",
        "http://host/a#x",
        "http://host/a?api_key=secret",
        "http://169.254.169.254/latest",
    ],
)
def test_endpoint_rejects_unsafe_values(endpoint: str) -> None:
    with pytest.raises(ValueError, match="HTTP"):
        validate_http_endpoint(endpoint)


@pytest.mark.parametrize(
    "options",
    [
        {"method": "DELETE"},
        {"timeout_s": "nan"},
        {"timeout_s": "11"},
        {"surprise": "value"},
        {"headers_json": '{"Authorization":"secret"}'},
        {"query_json": '{"access_token":"secret"}'},
        {"method": "POST", "body_json": '{"nested":{"password":"secret"}}'},
        {"body_json": "{}"},
        {"headers_json": '{"X-Foo":2}'},
        {"headers_json": '{"X-Foo":"bad\\r\\nheader"}'},
    ],
)
def test_options_reject_invalid_or_secret_values(
    options: dict[str, str],
) -> None:
    with pytest.raises(ValueError, match="HTTP 请求配置不合法"):
        HttpOptions.from_options(options)
