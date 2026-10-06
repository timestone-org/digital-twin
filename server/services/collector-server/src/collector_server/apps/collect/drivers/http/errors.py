"""HTTP 驱动的安全错误，不携带 URL、请求头或响应正文。"""

from collector_server.apps.collect.drivers.base import DriverError
from collectwire.commands import (
    REASON_HTTP_AUTH_REJECTED,
    REASON_HTTP_CONFIG_INVALID,
    REASON_HTTP_REQUEST_FAILED,
    REASON_HTTP_RESPONSE_INVALID,
)


class HttpConfigurationInvalid(DriverError):
    reason = REASON_HTTP_CONFIG_INVALID


class HttpAuthenticationRejected(DriverError):
    reason = REASON_HTTP_AUTH_REJECTED


class HttpRequestFailed(DriverError):
    reason = REASON_HTTP_REQUEST_FAILED


class HttpResponseInvalid(DriverError):
    reason = REASON_HTTP_RESPONSE_INVALID
