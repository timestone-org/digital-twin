"""opcua-server 内部端点的瘦客户端：批量解析节点、批量写值。

⚠ 零业务名词。本模块只认「一台实例下的一批节点 id 和要写进去的值」——
它不知道什么是模型、房间、组合，也不该知道。语义在 `apps/hvac`。

⚠ 与 `realtime.py` 的失败口径**有意相反**：hub 不可达时降级为「没有实时通道」
并返回 False，因为大屏照样要能打开；而这里不可达必须**抛**——绑定时问不到
节点却照样保存，等于把一份没校验过的配置存下来；发布时写不进去却不报错，
等于让页面上的心跳替一件没发生的事作证（docs/AC_PUBLISH_DESIGN.md §5.4）。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, ValidationError

from lib.logging import get_logger
from platform_server.realtime import current_traceparent

_logger = get_logger("platform.opcua")

RESOLVE_PATH = "/internal/v1/opcua/nodes:resolve"
WRITE_PATH = "/internal/v1/opcua/nodes:write"


class OpcuaCallFailed(Exception):
    """打 opcua-server 没打通。

    ⚠ 传输层的异常，不是领域异常：调用方（`apps/hvac`）负责把它翻译成
    面向用户的那一个。基础设施层不构造 HTTP 响应。
    """


@dataclass(frozen=True)
class ResolvedNode:
    """一个节点此刻的定义。`is_found` 为假时其余字段无意义。"""

    id: uuid.UUID
    is_found: bool
    identifier: str | None
    node_id: str | None
    data_type: str | None
    is_writable: bool


@dataclass(frozen=True)
class NodeWrite:
    """要写的一项。"""

    id: uuid.UUID
    value: object


@dataclass(frozen=True)
class WriteResult:
    """一项写值的去向。"""

    id: uuid.UUID
    is_written: bool
    identifier: str | None
    value: object | None
    error: str | None


class NodeWriter(Protocol):
    """下发面的最小契约。业务侧只认它，不认 httpx。"""

    async def resolve(
        self, *, instance_id: uuid.UUID, node_ids: Sequence[uuid.UUID]
    ) -> list[ResolvedNode]: ...

    async def write(
        self,
        *,
        instance_id: uuid.UUID,
        items: Sequence[NodeWrite],
        idempotency_key: str | None = None,
    ) -> list[WriteResult]: ...


class OpcuaClient:
    """打 opcua-server 内部端点的瘦客户端。构造不连网。"""

    def __init__(
        self, *, base_url: str, service_key: str, timeout_s: float
    ) -> None:
        """按地址与服务级密钥初始化。

        Args: base_url, service_key, timeout_s。
        """
        self._base_url = base_url.rstrip("/")
        self._service_key = service_key
        self._timeout_s = timeout_s
        # 传输层留成可替换的：用例验的是调用形状与失败处置，不是 httpx 本身
        self._transport: httpx.AsyncBaseTransport | None = None

    async def resolve(
        self, *, instance_id: uuid.UUID, node_ids: Sequence[uuid.UUID]
    ) -> list[ResolvedNode]:
        """批量取一组节点此刻的定义，顺序与入参一致。

        Args: instance_id, node_ids。
        """
        if not node_ids:
            return []
        payload = {
            "instance_id": str(instance_id),
            "ids": [str(node_id) for node_id in node_ids],
        }
        data = await self._post(RESOLVE_PATH, payload, action="resolve")
        return [_resolved(item) for item in _ResolveData.of(data).items]

    async def write(
        self,
        *,
        instance_id: uuid.UUID,
        items: Sequence[NodeWrite],
        idempotency_key: str | None = None,
    ) -> list[WriteResult]:
        """批量写值，顺序与入参一致。

        Args: instance_id, items, idempotency_key。
        """
        if not items:
            return []
        payload = {
            "instance_id": str(instance_id),
            "items": [
                {"id": str(item.id), "value": item.value} for item in items
            ],
        }
        data = await self._post(
            WRITE_PATH, payload, action="write", key=idempotency_key
        )
        return [_written(item) for item in _WriteData.of(data).items]

    async def _post(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        action: str,
        key: str | None = None,
    ) -> dict[str, Any]:
        """打一次 opcua-server，失败抛 `OpcuaCallFailed`。

        ⚠ **不重试**：这条链路上没有任何一层在重试。绑定时失败由人重新点保存，
        发布时失败由下一拍顶上——而下一拍带的是更新的数据。

        Args: path, payload, action, key。
        """
        try:
            async with self._client() as client:
                response = await client.post(
                    path, json=payload, headers=self._headers(key)
                )
                response.raise_for_status()
                return _envelope_data(response.json())
        except (httpx.HTTPError, ValidationError, ValueError) as error:
            _logger.error(
                "opcua_call_failed",
                "调用 opcua-server 失败",
                action=action,
                error_type=type(error).__name__,
            )
            raise OpcuaCallFailed(_reason(error)) from error

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout_s,
            transport=self._transport,
        )

    def _headers(self, key: str | None) -> dict[str, str]:
        """服务级密钥 + traceparent（+ 幂等键）。

        ⚠ traceparent 必须带：不带的话链路在「平台 → opcua-server」这一跳断开，
        而这一跳正是「值到底写没写进去」的答案所在。

        Args: key。
        """
        headers = {
            "X-Service-Key": self._service_key,
            "traceparent": current_traceparent(),
        }
        if key is not None:
            headers["Idempotency-Key"] = key
        return headers


def _reason(error: Exception) -> str:
    """给人看的失败原因，落在 `last_error` 与接口上。

    ⚠ 不带 URL 与密钥，只带异常类型：`last_error` 会显示在页面上。

    Args: error。
    """
    if isinstance(error, httpx.HTTPStatusError):
        return f"opcua-server 回了 {error.response.status_code}"
    if isinstance(error, httpx.TimeoutException):
        return "opcua-server 超时未响应"
    return "opcua-server 不可达"


def _envelope_data(body: object) -> dict[str, Any]:
    """从统一信封里取 data 段。

    ⚠ 用模型收口而不是逐层下标：信封变形时抛校验错并由 `_post` 记一条错误，
    逐层 `.get` 则会把它读成「一项都没有」，而那在发布循环里等于静默不发。

    Args: body。
    """
    return _Envelope.model_validate(body).data


class _Envelope(BaseModel):
    """统一信封，本地只取 data。"""

    data: dict[str, Any]


class _ResolvedItem(BaseModel):
    """解析回执里的一项。"""

    id: uuid.UUID
    is_found: bool
    identifier: str | None = None
    node_id: str | None = None
    data_type: str | None = None
    is_writable: bool = False


class _ResolveData(BaseModel):
    """解析回执的 data 段。"""

    items: list[_ResolvedItem]

    @classmethod
    def of(cls, data: dict[str, Any]) -> "_ResolveData":
        """按回执结构收口。

        Args: data。
        """
        return cls.model_validate(data)


class _WriteItem(BaseModel):
    """写值回执里的一项。"""

    id: uuid.UUID
    is_written: bool
    identifier: str | None = None
    value: object | None = None
    error: str | None = None


class _WriteData(BaseModel):
    """写值回执的 data 段。"""

    items: list[_WriteItem]

    @classmethod
    def of(cls, data: dict[str, Any]) -> "_WriteData":
        """按回执结构收口。

        Args: data。
        """
        return cls.model_validate(data)


def _resolved(item: _ResolvedItem) -> ResolvedNode:
    """回执项 → 对内形态。

    Args: item。
    """
    return ResolvedNode(
        id=item.id,
        is_found=item.is_found,
        identifier=item.identifier,
        node_id=item.node_id,
        data_type=item.data_type,
        is_writable=item.is_writable,
    )


def _written(item: _WriteItem) -> WriteResult:
    """回执项 → 对内形态。

    Args: item。
    """
    return WriteResult(
        id=item.id,
        is_written=item.is_written,
        identifier=item.identifier,
        value=item.value,
        error=item.error,
    )
