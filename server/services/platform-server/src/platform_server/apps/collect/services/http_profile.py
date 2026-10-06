"""HTTP 采集配置与点位寻址的静态校验，现场连接仍归 collector。"""

from collectwire.http import (
    HttpOptions,
    validate_http_endpoint,
    validate_http_pointer,
)
from lib.errors.base import FieldError
from platform_server.apps.collect.errors import PointInvalid, SourceInvalid
from platform_server.apps.collect.models import CollectSource
from platform_server.apps.collect.services.credentials import CredentialCipher

MIN_HTTP_POLL_INTERVAL_MS = 1000
MIN_HEADER_CHARACTER = 32
MAX_HEADER_CHARACTER = 126


def validate_http_source(
    source: CollectSource,
    cipher: CredentialCipher,
) -> None:
    """验证 HTTP 数据源保存后的完整配置。Args: source, cipher。"""
    if source.protocol != "http":
        return
    if (
        source.read_mode != "poll"
        or source.poll_interval_ms < MIN_HTTP_POLL_INTERVAL_MS
    ):
        raise SourceInvalid("HTTP 必须轮询，周期不得小于 1000ms")
    try:
        validate_http_endpoint(source.endpoint)
        options = HttpOptions.from_options(
            {str(key): str(value) for key, value in source.options_json.items()}
        )
    except ValueError as error:
        raise SourceInvalid(str(error)) from error
    _validate_credentials(source, cipher, options)


def _validate_credentials(
    source: CollectSource,
    cipher: CredentialCipher,
    options: HttpOptions,
) -> None:
    if options.auth_type == "none":
        if source.username is not None or source.credential_enc is not None:
            raise SourceInvalid("HTTP 匿名认证不能配置账号或凭据")
        return
    secret = (
        None
        if source.credential_enc is None
        else cipher.decrypt(source.credential_enc)
    )
    if secret is None or not secret.strip():
        raise SourceInvalid("HTTP 认证必须配置有效凭据")
    if options.auth_type in ("basic", "digest", "oauth2_client_credentials"):
        if source.username is None or not source.username.strip():
            raise SourceInvalid("此 HTTP 认证方式必须配置账号或 client_id")
    elif source.username is not None:
        raise SourceInvalid("此 HTTP 认证方式只使用凭据，不接受账号")
    if options.auth_type in ("bearer", "api_key") and any(
        ord(char) < MIN_HEADER_CHARACTER or ord(char) > MAX_HEADER_CHARACTER
        for char in secret
    ):
        raise SourceInvalid("HTTP 请求头凭据包含不合法字符")


def validate_http_address(
    protocol: str,
    address: str,
    *,
    field: str,
) -> None:
    """验证 HTTP 点位的 JSON Pointer 语法。Args: protocol, address, field。"""
    if protocol != "http":
        return
    try:
        validate_http_pointer(address)
    except ValueError as error:
        raise PointInvalid(
            "HTTP 点位地址不合法",
            details=(
                FieldError(
                    field=field,
                    code="invalid_http_pointer",
                    message=str(error),
                ),
            ),
        ) from error
