"""realtime-hub 的客户端：登记 / 注销主题、推送值变化。

一个实例一个主题 `opcua:<instance_id>`，声明的权限码恒为 `opcua:view`——
「能看这个实例」与「能订它的实时值」是同一件事，不该有第二套判据。

⚠ 登记与注销都是**旁路数据**，要与实例保持一致：实例删了而主题没注销，会
留下一个谁也推不到、却仍可被订阅的空主题。所以注销按 at-least-once 处理，
失败只记日志不阻断删除——阻断的话，hub 挂掉期间连实例都删不了。
"""

import uuid

import httpx
from pydantic import BaseModel, ValidationError

from lib.logging import get_logger
from lib.logging.context import current_log_context

_logger = get_logger("opcua.realtime")

# 订阅这个主题所需的权限码。⚠ 与 auth-server 目录里的字面量逐字一致，
# hub 在登记时会校验它存在——编错一个字，登记当场被拒
TOPIC_REQUIRED_CODE = "opcua:view"
TOPIC_PREFIX = "opcua"
PUBLISHER_NAME = "opcua-server"

TOPICS_PATH = "/internal/v1/realtime/topics"
PUBLISH_PATH = "/internal/v1/realtime/publish"

# W3C traceparent 的版本与采样标志位
_TRACE_VERSION = "00"
_TRACE_FLAGS = "01"


def topic_of(instance_id: uuid.UUID) -> str:
    """实例的主题名。形状照 api-contract §10 的 `<域>:<标识>`。

    Args: instance_id。
    """
    return f"{TOPIC_PREFIX}:{instance_id}"


class RealtimeClient:
    """打 hub 内部端点的瘦客户端。"""

    def __init__(
        self, *, base_url: str, service_key: str, timeout_s: float
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._service_key = service_key
        self._timeout_s = timeout_s
        # 传输层留成可替换的：用例要验的是调用形状与失败处置，不是 httpx 本身
        self._transport: httpx.AsyncBaseTransport | None = None

    async def declare(self, instance_id: uuid.UUID) -> bool:
        """登记实例的主题。返回是否登记成功。

        ⚠ 失败**不阻断建实例**：hub 不可达时实例照样能建、能起、上位机照样
        连得上，只是实时推送没有——降级方向必须是「少一个通道」而不是
        「建不了实例」。缺的那条主题由启动时的对账补上。

        Args: instance_id。
        """
        return await self._post(
            TOPICS_PATH,
            {
                "topic": topic_of(instance_id),
                "required_code": TOPIC_REQUIRED_CODE,
                "publisher": PUBLISHER_NAME,
            },
            action="declare",
        )

    async def topics(self) -> list[str]:
        """列出本服务在 hub 上登记的全部主题。对账用。

        ⚠ 取不到时返回**空列表**而不是抛：对账跑在启动路径上，hub 不可达时
        应当安静跳过这一轮（下次启动再对），而不是让服务起不来。
        ⚠ 空列表在对账里只会导致「补登记」，不会导致「清掉」——清的方向以
        hub 的清单为输入，输入为空就什么都不清。这个不对称是刻意的。

        """
        try:
            async with self._client() as client:
                response = await client.get(
                    TOPICS_PATH,
                    params={"publisher": PUBLISHER_NAME},
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

    async def revoke_topic(self, topic: str) -> bool:
        """按主题名注销。对账清理孤儿主题时用——那时实例已经不在了。

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

    async def revoke(self, instance_id: uuid.UUID) -> bool:
        """注销实例的主题。返回是否注销成功。

        Args: instance_id。
        """
        topic = topic_of(instance_id)
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
        instance_id: uuid.UUID,
        items: list[dict[str, object]],
        *,
        traceparent: str | None = None,
    ) -> bool:
        """推一批值变化。返回是否推送成功。

        ⚠ `traceparent` 要由调用方显式给：值变化的冲刷发生在**后台任务**里，
        那时请求上下文早已不在，按当前上下文取只会得到一串全零——链路从写值
        那一刻就断了。调用方在写入时捕获，随批次带过来。

        Args: instance_id, items, traceparent。
        """
        return await self._post(
            PUBLISH_PATH,
            {"topic": topic_of(instance_id), "items": items},
            action="publish",
            traceparent=traceparent,
        )

    async def _post(
        self,
        path: str,
        payload: dict[str, object],
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
        「推送方 → hub → 订阅方」这一跳断开。给了显式值就用它——后台任务里
        取当前上下文只会得到全零。

        Args: traceparent。
        """
        return {
            "X-Service-Key": self._service_key,
            "traceparent": traceparent or current_traceparent(),
        }


def current_traceparent() -> str:
    """把当前日志上下文压成一条 W3C traceparent。

    ⚠ 在后台任务里调它得到的是一串全零：contextvars 不跨任务传播。要保住
    链路，得在**还在请求上下文里**的时候取一次并带着走。
    """
    context = current_log_context()
    trace_id = (context.trace_id or "").replace("-", "").rjust(32, "0")[:32]
    span_id = (context.span_id or "").replace("-", "").rjust(16, "0")[:16]
    return f"{_TRACE_VERSION}-{trace_id}-{span_id}-{_TRACE_FLAGS}"


class _TopicsData(BaseModel):
    """信封里的 data 段。"""

    topics: list[str]


class _TopicsEnvelope(BaseModel):
    """hub 的统一信封，本地只取 data。

    ⚠ 用模型收口而不是逐层下标：信封变形时要响亮失败（由调用方转成「跳过
    本轮」），而不是让一个空列表流下去——空列表在对账里意味着「hub 上一个
    主题都没有」，而那会让补登记跑一遍全量。
    """

    data: _TopicsData
