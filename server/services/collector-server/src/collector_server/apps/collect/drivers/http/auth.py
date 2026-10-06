"""HTTP 认证及仅驻留会话内存的 OAuth2 client_credentials 令牌。"""

import time
from collections.abc import Callable
from urllib.parse import quote_plus

import httpx
from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError

from collector_server.apps.collect.drivers.base import DriverConnection
from collector_server.apps.collect.drivers.http.errors import (
    HttpAuthenticationRejected,
    HttpConfigurationInvalid,
)
from collector_server.apps.collect.drivers.http.target import resolve_target
from collector_server.apps.collect.drivers.http.transport import (
    TOKEN_RESPONSE_MAX_BYTES,
    fetch_json,
)
from collectwire.http import (
    MAX_HEADER_CHARACTER,
    MIN_HEADER_CHARACTER,
    HttpOptions,
)


class OAuthToken(BaseModel):
    """上游令牌响应边界。"""

    model_config = ConfigDict(extra="ignore")
    access_token: SecretStr = Field(min_length=1)
    token_type: str
    expires_in: float = Field(default=60, gt=0, allow_inf_nan=False)


class HttpAuthentication:
    """一个数据源的认证状态。"""

    def __init__(
        self,
        connection: DriverConnection,
        options: HttpOptions,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._connection = connection
        self._options = options
        self._clock = clock
        self._token: SecretStr | None = None
        self._expires_at_s = 0.0
        self.validate()

    def validate(self) -> None:
        secret = self._connection.password
        kind = self._options.auth_type
        if kind == "none" and (secret or self._connection.username):
            raise HttpConfigurationInvalid("匿名 HTTP 源不应携带认证凭据")
        if kind != "none" and not secret:
            raise HttpConfigurationInvalid("HTTP 认证缺少 credential")
        if (
            kind in ("basic", "digest", "oauth2_client_credentials")
            and not self._connection.username
        ):
            raise HttpConfigurationInvalid("HTTP 认证缺少用户名或 client_id")
        if (
            secret
            and kind in ("bearer", "api_key")
            and not _is_header_value(secret)
        ):
            raise HttpConfigurationInvalid("HTTP 认证凭据不是合法请求头值")

    def challenge_auth(self) -> httpx.Auth | None:
        username = self._connection.username or ""
        password = self._connection.password or ""
        if self._options.auth_type == "basic":
            return httpx.BasicAuth(username, password)
        if self._options.auth_type == "digest":
            return httpx.DigestAuth(username, password)
        return None

    async def headers(self, client: httpx.AsyncClient) -> dict[str, str]:
        kind = self._options.auth_type
        if kind == "api_key":
            return {self._options.auth_header: self._connection.password or ""}
        if kind == "bearer":
            return {
                "Authorization": f"Bearer {self._connection.password or ''}"
            }
        if kind == "oauth2_client_credentials":
            if self._token is None or self._clock() >= self._expires_at_s:
                await self._refresh(client)
            if self._token is None:
                raise HttpAuthenticationRejected("OAuth2 未返回令牌")
            return {"Authorization": f"Bearer {self._token.get_secret_value()}"}
        return {}

    def clear(self) -> None:
        self._token = None
        self._expires_at_s = 0

    async def _refresh(self, client: httpx.AsyncClient) -> None:
        target = await resolve_target(self._options.token_endpoint or "")
        data = {"grant_type": "client_credentials"}
        if self._options.scope:
            data["scope"] = self._options.scope
        started_s = self._clock()
        document = await fetch_json(
            client,
            target,
            max_bytes=TOKEN_RESPONSE_MAX_BYTES,
            request=client.build_request("POST", target.url, data=data),
            auth=httpx.BasicAuth(
                quote_plus(self._connection.username or "", safe=""),
                quote_plus(self._connection.password or "", safe=""),
            ),
        )
        try:
            token = OAuthToken.model_validate(document)
            if token.token_type.casefold() != "bearer":
                raise ValueError("OAuth2 令牌类型必须为 Bearer")
            value = token.access_token.get_secret_value()
            if not _is_header_value(value):
                raise ValueError("OAuth2 令牌不是合法请求头值")
        except (ValidationError, ValueError) as error:
            raise HttpAuthenticationRejected("OAuth2 令牌响应不合法") from error
        self._token = token.access_token
        skew_s = min(30.0, token.expires_in / 10)
        self._expires_at_s = started_s + token.expires_in - skew_s


def _is_header_value(value: str) -> bool:
    return all(
        MIN_HEADER_CHARACTER <= ord(char) <= MAX_HEADER_CHARACTER
        for char in value
    )
