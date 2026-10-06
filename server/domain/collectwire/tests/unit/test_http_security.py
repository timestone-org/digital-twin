"""HTTP 配置拒绝常见秘密命名变体、畸形 JSON 与路由覆盖。"""

import json
from urllib.parse import urlencode

import pytest

from collectwire.http import (
    HttpOptions,
    http_origin,
    validate_http_endpoint,
    validate_http_pointer,
)


@pytest.mark.parametrize(
    "name",
    [
        "apiKey",
        "accessToken",
        "refreshToken",
        "clientSecret",
        " password ",
        "X-Auth-Token",
    ],
)
@pytest.mark.parametrize("location", ["header", "query", "body", "nested-body"])
def test_secret_name_variants_cannot_enter_public_request_options(
    name: str,
    location: str,
) -> None:
    secret = "test-only-sensitive-option-value"
    options = {"method": "POST"}
    payload = {name: secret}
    if location == "nested-body":
        options["body_json"] = json.dumps({"items": [payload]})
    else:
        key = {
            "header": "headers_json",
            "query": "query_json",
            "body": "body_json",
        }[location]
        options[key] = json.dumps(payload)
    with pytest.raises(ValueError, match="HTTP") as captured:
        HttpOptions.from_options(options)
    assert secret not in str(captured.value)


@pytest.mark.parametrize(
    "name", ["apiKey", "accessToken", "clientSecret", " password "]
)
def test_secret_query_name_variants_cannot_enter_endpoint(name: str) -> None:
    secret = "test-only-sensitive-url-value"
    endpoint = "https://api.example.test/data?" + urlencode({name: secret})
    with pytest.raises(ValueError, match="HTTP") as captured:
        validate_http_endpoint(endpoint)
    assert secret not in str(captured.value)


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_post_body_rejects_non_json_numeric_constants(literal: str) -> None:
    with pytest.raises(ValueError, match="HTTP"):
        HttpOptions.from_options(
            {"method": "POST", "body_json": '{"value":' + literal + "}"}
        )


@pytest.mark.parametrize(
    "header",
    [
        "host",
        "Content-Length",
        "transfer-encoding",
        "Proxy-Authorization",
        "COOKIE",
    ],
)
def test_api_key_header_cannot_override_routing_or_cookie_state(
    header: str,
) -> None:
    with pytest.raises(ValueError, match="HTTP"):
        HttpOptions.from_options(
            {"auth_type": "api_key", "auth_header": header}
        )


@pytest.mark.parametrize(
    "options",
    [
        {"headers_json": '{"X-Data":"a","x-data":"b"}'},
        {
            "auth_type": "api_key",
            "auth_header": "X-Credential",
            "headers_json": '{"x-credential":"plaintext"}',
        },
        {
            "query_json": "{"
            + ",".join(f'"field{index}":"value"' for index in range(65))
            + "}"
        },
        {"method": "POST", "body_json": "[" * 65 + "0" + "]" * 65},
    ],
    ids=[
        "case-duplicate-headers",
        "api-key-header-collision",
        "query-field-limit",
        "body-depth-limit",
    ],
)
def test_request_shape_limits_cannot_be_bypassed(
    options: dict[str, str],
) -> None:
    with pytest.raises(ValueError, match="HTTP"):
        HttpOptions.from_options(options)


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://169.254.169.254/latest",
        "http://[::ffff:169.254.169.254]/latest",
        "http://[fe80::1]/data",
        "http://[::]/data",
        "http://224.0.0.1/data",
        "http://100.100.100.200/latest/meta-data/",
        "http://[::ffff:100.100.100.200]/latest/meta-data/",
        "http://[fd00:ec2::254]/latest/meta-data/",
        "http://[fd00:ec2::254%1]/latest/meta-data/",
        "http://[fd00:ec2::254%eth0]/latest/meta-data/",
        "http://[fd00:ec2::254%25eth0]/latest/meta-data/",
    ],
)
def test_metadata_and_non_unicast_literals_are_rejected(endpoint: str) -> None:
    with pytest.raises(ValueError, match="HTTP"):
        validate_http_endpoint(endpoint)


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://100.100.100.200/latest/token",
        "http://[fd00:ec2::254]/latest/token",
        "http://[fd00:ec2::254%1]/latest/token",
    ],
    ids=["alibaba-metadata", "aws-ipv6-metadata", "aws-ipv6-scoped-metadata"],
)
def test_oauth_endpoint_cannot_use_cloud_metadata(endpoint: str) -> None:
    with pytest.raises(ValueError, match="HTTP"):
        HttpOptions.from_options(
            {
                "auth_type": "oauth2_client_credentials",
                "token_endpoint": endpoint,
            }
        )


def test_origin_normalization_retains_scheme_host_and_effective_port() -> None:
    assert (
        http_origin("https://API.EXAMPLE.test/data?device=1")
        == "https://api.example.test:443"
    )
    assert (
        http_origin("http://192.168.1.10:8080/readings")
        == "http://192.168.1.10:8080"
    )
    assert http_origin("http://[::1]:8080/data") == "http://[::1]:8080"
    assert (
        http_origin("http://[fd00:1234::20%1]:8080/data")
        == "http://[fd00:1234::20%1]:8080"
    )


@pytest.mark.parametrize(
    "options",
    [
        {"headers_json": json.dumps({"X-Data": "x" * 65536})},
        {"method": "POST", "body_json": json.dumps("x" * 65536)},
        {"auth_type": "api_key", "auth_header": "invalid header"},
        {"auth_type": "oauth2_client_credentials"},
        {
            "auth_type": "oauth2_client_credentials",
            "token_endpoint": "http://user:secret@api.example.test/token",
        },
        {"scope": "readings"},
        {"token_endpoint": "https://api.example.test/token"},
    ],
    ids=[
        "header-size",
        "body-size",
        "api-key-header-syntax",
        "oauth-missing-endpoint",
        "oauth-url-userinfo",
        "unexpected-scope",
        "unexpected-token-endpoint",
    ],
)
def test_config_size_and_auth_endpoint_boundaries_are_explicit(
    options: dict[str, str],
) -> None:
    with pytest.raises(ValueError, match="HTTP"):
        HttpOptions.from_options(options)


@pytest.mark.parametrize("address", ["/" + "x" * 1024, "/a" * 65])
def test_pointer_size_and_depth_are_bounded(address: str) -> None:
    with pytest.raises(ValueError, match="HTTP"):
        validate_http_pointer(address)


@pytest.mark.parametrize(
    "endpoint",
    ["https://api.example.test:invalid/data", "http://[missing/data"],
)
def test_malformed_host_or_port_does_not_escape_validation(
    endpoint: str,
) -> None:
    with pytest.raises(ValueError, match="HTTP"):
        validate_http_endpoint(endpoint)


def test_valid_oauth_configuration_retains_only_public_options() -> None:
    options = HttpOptions.from_options(
        {
            "auth_type": "oauth2_client_credentials",
            "token_endpoint": "https://identity.example.test/token",
            "scope": "readings",
        }
    )
    assert options.token_endpoint == "https://identity.example.test/token"
    assert options.scope == "readings"


def test_post_body_supports_empty_arrays_and_finite_numbers() -> None:
    options = HttpOptions.from_options(
        {"method": "POST", "body_json": "[[],1.25]"}
    )
    assert options.body() == [[], 1.25]
