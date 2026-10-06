"""HTTP 请求配置的共享线形及静态校验，零网络 IO（ADR-0057）。"""

import ipaddress
import math
import re
from collections.abc import Mapping
from typing import Literal, Self
from urllib.parse import parse_qsl, urlsplit

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    TypeAdapter,
    ValidationError,
    model_validator,
)

MAX_CONFIG_BYTES = 65_536
MAX_POINTER_LENGTH = 1024
MAX_POINTER_DEPTH = 64
MAX_REQUEST_FIELDS = 64
MAX_JSON_DEPTH = 64
MAX_RESPONSE_BYTES = 4_194_304
MAX_ENDPOINT_LENGTH = 2048
MIN_HEADER_CHARACTER = 32
MAX_HEADER_CHARACTER = 126
SENSITIVE_NAMES = frozenset(
    {
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "password",
        "passwd",
        "secret",
        "client_secret",
        "access_token",
        "refresh_token",
        "token",
        "api_key",
        "apikey",
        "x-api-key",
        "key",
    }
)
_HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$")
_BAD_ESCAPE = re.compile(r"~(?![01])")
_SENSITIVE_CANONICAL = frozenset(
    re.sub(r"[^a-z0-9]", "", name) for name in SENSITIVE_NAMES
)
_CLOUD_METADATA_ADDRESSES = frozenset(
    {
        ipaddress.ip_address("100.100.100.200"),
        ipaddress.ip_address("fd00:ec2::254"),
    }
)


def _is_sensitive(name: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", name.casefold())
    return normalized in _SENSITIVE_CANONICAL or normalized.endswith(
        ("token", "password", "secret", "apikey")
    )


def validate_http_endpoint(endpoint: str) -> None:
    """验证 HTTP URL 无凭据、片段与秘密查询参数。

    Args: endpoint。
    """
    try:
        parsed = urlsplit(endpoint)
        port = parsed.port
    except ValueError as error:
        raise ValueError("HTTP 端点不合法") from error
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
        or port == 0
        or len(endpoint) > MAX_ENDPOINT_LENGTH
        or any(ord(char) <= MIN_HEADER_CHARACTER for char in endpoint)
    ):
        raise ValueError("HTTP 端点必须是不含凭据的 HTTP(S) URL")
    if any(_is_sensitive(key) for key, _ in parse_qsl(parsed.query)):
        raise ValueError("HTTP URL 禁止包含认证秘密")
    try:
        address = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        return
    validate_http_ip(address)


def validate_http_ip(
    address: ipaddress.IPv4Address | ipaddress.IPv6Address,
) -> None:
    """验证 HTTP 目标 IP，静态端点与 DNS 解析共用。Args: address。"""
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    if (
        ipaddress.ip_address(address.packed) in _CLOUD_METADATA_ADDRESSES
        or address.is_link_local
        or address.is_multicast
        or address.is_unspecified
    ):
        raise ValueError("HTTP 禁止访问云元数据、链路本地及非单播目标")


def http_origin(endpoint: str) -> str:
    """返回出站授权使用的精确 origin。

    Args: endpoint。
    """
    validate_http_endpoint(endpoint)
    parsed = urlsplit(endpoint)
    host = parsed.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return f"{parsed.scheme}://{host}:{port}"


def validate_http_pointer(address: str) -> None:
    """验证 RFC 6901 路径；根值使用 $。

    Args: address。
    """
    if address == "$":
        return
    if (
        not address.startswith("/")
        or _BAD_ESCAPE.search(address)
        or len(address) > MAX_POINTER_LENGTH
        or address.count("/") > MAX_POINTER_DEPTH
    ):
        raise ValueError("HTTP 点位地址必须是 JSON Pointer 或根值 $")


def read_string_map(value: str) -> dict[str, str]:
    """解析有上限的字符串映射。

    Args: value。
    """
    if len(value.encode()) > MAX_CONFIG_BYTES:
        raise ValueError("HTTP 请求配置超过大小上限")
    try:
        fields = TypeAdapter(dict[str, str]).validate_json(value, strict=True)
    except ValidationError as error:
        raise ValueError("HTTP 参数必须是字符串键值 JSON 对象") from error
    if len(fields) > MAX_REQUEST_FIELDS:
        raise ValueError("HTTP 请求字段超过数量上限")
    return fields


def _validate_public_json(value: JsonValue, depth: int = 0) -> None:
    if depth > MAX_JSON_DEPTH:
        raise ValueError("HTTP 请求 JSON 超过深度上限")
    if isinstance(value, dict):
        if any(_is_sensitive(key) for key in value):
            raise ValueError("HTTP 请求配置禁止包含认证秘密")
        for child in value.values():
            _validate_public_json(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            _validate_public_json(child, depth + 1)
    elif isinstance(value, float) and not math.isfinite(value):
        raise ValueError("HTTP 请求 JSON 禁止非有限数值")


class HttpOptions(BaseModel):
    """只包含非秘密项的 HTTP 请求配置。"""

    model_config = ConfigDict(frozen=True, extra="forbid")

    method: Literal["GET", "POST"] = "GET"
    auth_type: Literal[
        "none",
        "basic",
        "digest",
        "bearer",
        "api_key",
        "oauth2_client_credentials",
    ] = "none"
    auth_header: str = Field(default="X-API-Key", min_length=1, max_length=128)
    headers_json: str = "{}"
    query_json: str = "{}"
    body_json: str | None = None
    timeout_s: float = Field(default=5, gt=0, le=10, allow_inf_nan=False)
    max_response_bytes: int = Field(
        default=1_048_576, ge=1, le=MAX_RESPONSE_BYTES
    )
    token_endpoint: str | None = None
    scope: str | None = Field(default=None, max_length=1024)

    @classmethod
    def from_options(cls, options: Mapping[str, str]) -> Self:
        """解析计划或 API 的字符串配置映射。

        Args: options。
        """
        try:
            return cls.model_validate(dict(options))
        except (ValueError, RecursionError) as error:
            raise ValueError("HTTP 请求配置不合法") from error

    def headers(self) -> dict[str, str]:
        return read_string_map(self.headers_json)

    def query(self) -> dict[str, str]:
        return read_string_map(self.query_json)

    def body(self) -> JsonValue:
        if self.body_json is None:
            return None
        if len(self.body_json.encode()) > MAX_CONFIG_BYTES:
            raise ValueError("HTTP 请求 JSON 超过大小上限")
        adapter: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)
        return adapter.validate_json(self.body_json)

    @model_validator(mode="after")
    def validate_request(self) -> Self:
        if not _HEADER_NAME.fullmatch(self.auth_header):
            raise ValueError("HTTP API Key 头名称不合法")
        if self.auth_header.casefold() in (
            "host",
            "cookie",
            "set-cookie",
            "proxy-authorization",
            "content-length",
            "transfer-encoding",
        ):
            raise ValueError("HTTP API Key 不允许使用此请求头")
        self._validate_headers()
        if any(_is_sensitive(name) for name in self.query()):
            raise ValueError("HTTP 查询参数禁止保存认证秘密")
        if self.body_json is not None and self.method != "POST":
            raise ValueError("HTTP 请求体只能用于 POST 查询")
        _validate_public_json(self.body())
        if self.auth_type == "oauth2_client_credentials":
            if self.token_endpoint is None:
                raise ValueError("OAuth2 必须配置 token_endpoint")
            validate_http_endpoint(self.token_endpoint)
        elif self.token_endpoint is not None or self.scope is not None:
            raise ValueError("token_endpoint 和 scope 只用于 OAuth2")
        return self

    def _validate_headers(self) -> None:
        headers = self.headers()
        if len({name.casefold() for name in headers}) != len(headers):
            raise ValueError("HTTP 请求头不能重复")
        for name, value in headers.items():
            if not _HEADER_NAME.fullmatch(name) or any(
                ord(char) < MIN_HEADER_CHARACTER
                or ord(char) > MAX_HEADER_CHARACTER
                for char in value
            ):
                raise ValueError("HTTP 请求头格式不合法")
            if _is_sensitive(name) or name.casefold() in (
                "host",
                "content-length",
                "transfer-encoding",
            ):
                raise ValueError("HTTP 请求头禁止保存认证秘密或路由覆盖")
            if (
                self.auth_type == "api_key"
                and name.casefold() == self.auth_header.casefold()
            ):
                raise ValueError("HTTP API Key 请求头必须通过 credential 配置")
