"""从 platform 拉全量采集计划。collector 对 platform 的**唯一**依赖。

内部面 + 服务级密钥，预算 5s（runtime-resilience §3.1）。
"""

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from collector_server.apps.collect.errors import PlanUnavailable
from collectwire import CollectPlan
from lib.logging import get_logger

_logger = get_logger("collect.plan.client")

PLAN_PATH = "/internal/v1/platform/collect-plan"


class _PlanEnvelope(BaseModel):
    """统一信封的 `data` 段就是计划本体。"""

    model_config = ConfigDict(extra="ignore")

    data: CollectPlan


class PlanClient:
    """打 platform 内部端点的瘦客户端。"""

    def __init__(
        self, *, base_url: str, service_key: str, timeout_s: float
    ) -> None:
        """按地址与密钥初始化。

        Args: base_url, service_key, timeout_s。
        """
        self._base_url = base_url.rstrip("/")
        self._service_key = service_key
        self._timeout_s = timeout_s
        # 传输层留成可替换的：用例验的是调用形状与失败处置，不是 httpx 本身
        self._transport: httpx.AsyncBaseTransport | None = None

    async def fetch(self) -> CollectPlan:
        """拉一次全量计划。任何失败都抛 PlanUnavailable。

        ⚠ 这里**不重试**：重试归上层的定期刷新循环，一条链路只有一层负责
        重试，逐层重试会相乘成雪崩（runtime-resilience §4.2）。
        """
        try:
            async with self._client() as client:
                response = await client.get(
                    PLAN_PATH, headers={"X-Service-Key": self._service_key}
                )
                response.raise_for_status()
                envelope = _PlanEnvelope.model_validate(response.json())
        except (httpx.HTTPError, ValidationError, ValueError) as error:
            _logger.error(
                "plan_fetch_failed",
                "拉采集计划失败",
                error_type=type(error).__name__,
            )
            raise PlanUnavailable("拉不到采集计划") from error
        return envelope.data

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout_s,
            transport=self._transport,
        )
