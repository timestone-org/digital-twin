"""固定部署端点的 BDM 只读客户端，不跟随跳转或使用环境代理。"""

import asyncio
from dataclasses import dataclass
from http import HTTPStatus
from types import TracebackType
from typing import Self

import httpx
from pydantic import BaseModel, JsonValue, SecretStr, ValidationError

from lib.errors import AppError
from lib.logging import current_traceparent
from platform_server.apps.modeling.schemas.bdm import BdmEnvelope
from platform_server.settings import Settings

PREFIX = "/api/bdm/training-data"
MAX_RESPONSE_BYTES = 2_000_000


class BdmReadFailed(AppError):
    """外部接口未能提供可信结果。"""

    code = 51401
    http_status = 503


@dataclass(frozen=True)
class BdmConnection:
    """仅保存在服务端的连接配置。"""

    base_url: str
    api_key: SecretStr
    timezone: str
    timeout_s: float
    load_timeout_s: float


def configured_connection(settings: Settings) -> BdmConnection | None:
    """把已校验的部署设置装成外部读口。Args: settings。"""
    if not settings.bdm_enabled:
        return None
    if settings.bdm_base_url is None or settings.bdm_api_key is None:
        raise BdmReadFailed("BDM 接口未配置，请联系管理员")
    return BdmConnection(
        base_url=settings.bdm_base_url,
        api_key=settings.bdm_api_key,
        timezone=settings.bdm_timezone,
        timeout_s=settings.bdm_timeout_s,
        load_timeout_s=settings.bdm_load_timeout_s,
    )


class BdmClient:
    """有界响应、真实状态码与业务码双重校验的异步读口。"""

    def __init__(
        self,
        connection: BdmConnection,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.connection = connection
        self._client = httpx.AsyncClient(
            base_url=connection.base_url,
            headers={
                "X-API-Key": connection.api_key.get_secret_value(),
                "Accept": "application/json",
            },
            timeout=connection.timeout_s,
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )

    async def __aenter__(self) -> Self:
        await self._client.__aenter__()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self._client.__aexit__(exc_type, exc, traceback)

    async def read[Result: BaseModel](
        self,
        path: str,
        model: type[Result],
        *,
        params: dict[str, str | int] | None = None,
        payload: dict[str, JsonValue] | None = None,
    ) -> Result:
        """读取固定路径并校验形状。

        Args: path, model, params, payload。
        """
        try:
            async with asyncio.timeout(self.connection.timeout_s):
                raw = await self._read_bytes(
                    path, params=params, payload=payload
                )
            envelope = BdmEnvelope.model_validate_json(raw)
            if envelope.code != HTTPStatus.OK or envelope.data is None:
                raise BdmReadFailed("BDM 接口未返回成功结果，请检查数据源状态")
            return model.model_validate(envelope.data)
        except (httpx.HTTPError, TimeoutError):
            raise BdmReadFailed("BDM 接口连接失败或超时，请稍后重试") from None
        except ValidationError:
            raise BdmReadFailed("BDM 接口响应格式不符合取数契约") from None

    async def _read_bytes(
        self,
        path: str,
        *,
        params: dict[str, str | int] | None,
        payload: dict[str, JsonValue] | None,
    ) -> bytes:
        chunks = bytearray()
        async with self._client.stream(
            "GET" if payload is None else "POST",
            PREFIX + path,
            params=params,
            json=payload,
            headers={"traceparent": current_traceparent()},
        ) as response:
            _check_status(response)
            async for chunk in response.aiter_bytes():
                if len(chunks) + len(chunk) > MAX_RESPONSE_BYTES:
                    raise BdmReadFailed("BDM 响应超过单页大小上限")
                chunks.extend(chunk)
        return bytes(chunks)


def _check_status(response: httpx.Response) -> None:
    if response.status_code in (HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN):
        raise BdmReadFailed("BDM 访问凭据无效，请联系管理员")
    if response.status_code == HTTPStatus.BAD_REQUEST:
        raise BdmReadFailed("BDM 拒绝了取数参数，请核对目录标识与时间范围")
    if response.status_code != HTTPStatus.OK:
        raise BdmReadFailed(f"BDM 接口暂不可用（HTTP {response.status_code}）")
    if (
        "application/json"
        not in response.headers.get("content-type", "").lower()
    ):
        raise BdmReadFailed("BDM 接口返回了非 JSON 内容")
