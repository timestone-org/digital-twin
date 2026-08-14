"""realtime-hub 内部端点的瘦客户端：登记 / 列出 / 注销主题、推送。

主题名与它要求的权限码是**业务口径**，不在这里——本模块只认「一个不透明的
主题字符串」，与 hub 对主题的态度一致（ADR-0007）。
⚠ 每一处失败都只记日志并回 False：hub 不可达降级为「没有实时通道」，绝不
降级为「大屏打不开」（DASHBOARD_DESIGN §6）。
"""

from typing import Any, Protocol

import httpx
from pydantic import BaseModel, ValidationError

from lib.logging import get_logger
from lib.logging.context import current_log_context

_logger = get_logger("platform.realtime")

TOPICS_PATH = "/internal/v1/realtime/topics"
PUBLISH_PATH = "/internal/v1/realtime/publish"

# W3C traceparent 的版本与采样标志位
_TRACE_VERSION = "00"
_TRACE_FLAGS = "01"
_TRACE_ID_LENGTH = 32
_SPAN_ID_LENGTH = 16


class FramePublisher(Protocol):
    """推送面的最小契约。业务侧只认它，不认 httpx。"""

    async def publish(
        self,
        *,
        topic: str,
        items: list[dict[str, Any]],
        traceparent: str | None = None,
    ) -> bool: ...


class TopicRegistrar(Protocol):
    """主题登记面的最小契约。对账只需要这三件。"""

    async def declare(
        self, *, topic: str, required_code: str, publisher: str
    ) -> bool: ...

    async def topics(self, publisher: str) -> list[str]: ...

    async def revoke(self, topic: str) -> bool: ...


class RealtimeClient:
    """打 hub 内部端点的瘦客户端。构造不连网。"""

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

    async def declare(
        self, *, topic: str, required_code: str, publisher: str
    ) -> bool:
        """登记一个主题并声明订阅它所需的权限码。返回是否登记成功。

        同码重复登记在 hub 那边是幂等的，故对账可以放心重登。

        Args: topic, required_code, publisher。
        """
        return await self._post(
            TOPICS_PATH,
            {
                "topic": topic,
                "required_code": required_code,
                "publisher": publisher,
            },
            action="declare",
        )

    async def topics(self, publisher: str) -> list[str]:
        """列出本推送方在 hub 上登记的全部主题。对账用。

        ⚠ 取不到时返回**空列表**而不是抛：对账跑在发布循环里，hub 不可达时
        应当安静跳过这一轮，而不是让整个循环出错。
        ⚠ 空列表在对账里只会导致「补登记」，不会导致「注销」——注销的方向以
        hub 的清单为输入，输入为空就什么都不注销。这个不对称是刻意的。

        Args: publisher。
        """
        try:
            async with self._client() as client:
                response = await client.get(
                    TOPICS_PATH,
                    params={"publisher": publisher},
                    headers=self._headers(),
                )
                response.raise_for_status()
                envelope = _TopicsEnvelope.model_validate(response.json())
                return list(envelope.data.topics)
        except (httpx.HTTPError, ValidationError, ValueError) as error:
            _logger.warning(
                "topic_list_failed",
                "取主题清单失败，本轮对账跳过",
                error_type=type(error).__name__,
            )
            return []

    async def revoke(self, topic: str) -> bool:
        """注销一个主题。返回是否注销成功。

        ⚠ 注销是 at-least-once：hub 那边重复注销不报错，失败的那次由下一轮
        对账补上。返回值必须被用上，否则「注销失败」就是静默的。

        Args: topic。
        """
        try:
            async with self._client() as client:
                response = await client.delete(
                    f"{TOPICS_PATH}/{topic}", headers=self._headers()
                )
                response.raise_for_status()
        except httpx.HTTPError as error:
            _logger.error(
                "topic_revoke_failed",
                "注销主题失败，留下了一个空主题",
                topic=topic,
                error_type=type(error).__name__,
            )
            return False
        return True

    async def publish(
        self,
        *,
        topic: str,
        items: list[dict[str, Any]],
        traceparent: str | None = None,
    ) -> bool:
        """推一批条目。返回是否推送成功。

        ⚠ **seq 归 hub**：本方法不带任何序号，也不读它的回执里的 seq——推送方
        自己编号就会在副本切换时倒退，而客户端把倒退读成丢帧。

        Args: topic, items, traceparent。
        """
        return await self._post(
            PUBLISH_PATH,
            {"topic": topic, "items": items},
            action="publish",
            traceparent=traceparent,
        )

    async def _post(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        action: str,
        traceparent: str | None = None,
    ) -> bool:
        """打一次 hub，失败只记日志不抛。

        Args: path, payload, action, traceparent。
        """
        try:
            async with self._client() as client:
                response = await client.post(
                    path,
                    json=payload,
                    headers=self._headers(traceparent=traceparent),
                )
                response.raise_for_status()
        except httpx.HTTPError as error:
            _logger.error(
                "realtime_call_failed",
                "调用 realtime-hub 失败",
                action=action,
                error_type=type(error).__name__,
            )
            return False
        return True

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout_s,
            transport=self._transport,
        )

    def _headers(self, *, traceparent: str | None = None) -> dict[str, str]:
        """服务级密钥 + traceparent。

        ⚠ traceparent 必须带：hub 会把它原样放进扇出信封，不带的话链路在
        「推送方 → hub → 订阅方」这一跳断开。

        Args: traceparent。
        """
        return {
            "X-Service-Key": self._service_key,
            "traceparent": traceparent or current_traceparent(),
        }


def current_traceparent() -> str:
    """把当前日志上下文压成一条 W3C traceparent。

    ⚠ 发布循环必须在每一拍开头绑一次新的 trace 再调它：contextvars 不跨任务
    传播，没绑就取到一串全零，链路在这一跳齐断。
    """
    context = current_log_context()
    trace_id = (context.trace_id or "").replace("-", "")
    span_id = (context.span_id or "").replace("-", "")
    return (
        f"{_TRACE_VERSION}"
        f"-{trace_id.rjust(_TRACE_ID_LENGTH, '0')[:_TRACE_ID_LENGTH]}"
        f"-{span_id.rjust(_SPAN_ID_LENGTH, '0')[:_SPAN_ID_LENGTH]}"
        f"-{_TRACE_FLAGS}"
    )


class _TopicsData(BaseModel):
    """信封里的 data 段。"""

    topics: list[str]


class _TopicsEnvelope(BaseModel):
    """hub 的统一信封，本地只取 data。

    ⚠ 用模型收口而不是逐层下标：信封变形时抛校验错，由 `topics` 记一条告警后
    按「这一轮问不到」处理。逐层 `.get` 则连告警都没有，而对账把空清单读成
    「hub 上一个主题都没有」，于是每一轮都把全量大屏重登记一遍。
    """

    data: _TopicsData
