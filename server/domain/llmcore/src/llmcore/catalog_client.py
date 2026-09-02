"""从平台拉模型目录：内部面 + 服务级密钥，按 TTL 缓存，拉不到就用上一份。

⚠ 这一层**不重试**：一条链路只有一层负责重试，而消费方的调用面本来就按周期
再来问一次（runtime-resilience §4.2）。

⚠ 拉失败**不清空**手上那一份：清空等于让一次平台抖动把所有会话打回环境变量
配的那一档，而那一档可能根本没配——表现是「助手忽然说没接模型」。陈旧的
那一份照用，并在日志里标明它是陈旧的（runtime-resilience §9）。

⚠ 密钥不进日志、不进异常信息。
"""

import asyncio
import time
from collections.abc import Callable
from typing import Protocol

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from lib.errors import DependencyUnavailable
from lib.logging import get_logger
from llmcore.catalog import EMPTY_CATALOG, CatalogMalformed, ModelCatalog

_logger = get_logger("chat.llm.catalog")

# 平台内部面上目录的路径。⚠ 与平台侧的路由逐字一致，由契约用例守着
CATALOG_PATH = "/internal/v1/platform/llm-catalog"
SERVICE_KEY_HEADER = "X-Service-Key"

Clock = Callable[[], float]


class CatalogUnavailable(DependencyUnavailable):
    """目录此刻拉不到。"""

    code = 52204


class CatalogSource(Protocol):
    """消费方认的那一面：此刻手上的目录、以及「该刷新就刷新」。"""

    def snapshot(self) -> ModelCatalog:
        """最近一次拉到的目录；一次都没拉到时是空目录。"""
        ...

    async def refresh(self, *, is_forced: bool = False) -> ModelCatalog:
        """过了 TTL 就重拉一次；失败照旧用手上那一份。

        Args: is_forced（不看 TTL，立刻拉）。
        """
        ...


class _Envelope(BaseModel):
    """统一信封，本地只取 data。"""

    model_config = ConfigDict(extra="ignore")

    data: object = None


class CatalogClient:
    """打平台内部端点的瘦客户端。构造不连网。"""

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

    def use_transport(self, transport: httpx.AsyncBaseTransport) -> None:
        """换掉传输层。只给测试用。

        Args: transport。
        """
        self._transport = transport

    async def fetch(self) -> ModelCatalog:
        """拉一次全量目录。任何失败都抛 `CatalogUnavailable`。"""
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout_s,
                transport=self._transport,
            ) as client:
                response = await client.get(
                    CATALOG_PATH,
                    headers={SERVICE_KEY_HEADER: self._service_key},
                )
                response.raise_for_status()
                envelope = _Envelope.model_validate(response.json())
            return ModelCatalog.from_wire(envelope.data)
        except (
            httpx.HTTPError,
            ValidationError,
            ValueError,
            CatalogMalformed,
        ) as error:
            raise CatalogUnavailable("模型目录暂时拉不到") from error


class CatalogCache:
    """按 TTL 缓存的目录。一个进程一份。

    ⚠ 刷新是单飞的：同一时刻十个请求发现过期时只让一个去拉，其余等它——
    各拉各的话，平台在每个 TTL 边界上都会被打一排相同的请求。
    """

    def __init__(
        self,
        client: CatalogClient,
        *,
        ttl_s: float,
        clock: Clock = time.monotonic,
    ) -> None:
        """Args: client, ttl_s（多久算旧）, clock（用例可注入）。"""
        self._client = client
        self._ttl_s = ttl_s
        self._clock = clock
        self._catalog = EMPTY_CATALOG
        self._fetched_at: float | None = None
        self._is_failing = False
        self._lock = asyncio.Lock()

    def snapshot(self) -> ModelCatalog:
        """最近一次拉到的目录；一次都没拉到时是空目录。"""
        return self._catalog

    @property
    def is_stale(self) -> bool:
        """手上这一份过了 TTL 没有。"""
        if self._fetched_at is None:
            return True
        return self._clock() - self._fetched_at >= self._ttl_s

    async def refresh(self, *, is_forced: bool = False) -> ModelCatalog:
        """过了 TTL 就重拉一次；失败照旧用手上那一份。

        Args: is_forced。
        """
        if not is_forced and not self.is_stale:
            return self._catalog
        async with self._lock:
            # 等锁期间别人可能已经拉完了
            if not is_forced and not self.is_stale:
                return self._catalog
            await self._pull()
        return self._catalog

    async def _pull(self) -> None:
        try:
            fetched = await self._client.fetch()
        except CatalogUnavailable as error:
            # ⚠ 失败也推进时间戳：不推进的话每一次调用都会再打一遍平台，
            # 而平台正是此刻不行的那一个
            self._fetched_at = self._clock()
            if not self._is_failing:
                _logger.warning(
                    "llm_catalog_refresh_failed",
                    "模型目录拉不到，沿用陈旧的那一份",
                    error_type=type(error.__cause__ or error).__name__,
                    is_stale=True,
                )
            self._is_failing = True
            return
        changed = fetched.version != self._catalog.version
        self._catalog = fetched
        self._fetched_at = self._clock()
        if self._is_failing or changed:
            _logger.info(
                "llm_catalog_refreshed",
                "模型目录已更新",
                version=fetched.version,
                providers=len(fetched.providers),
            )
        self._is_failing = False
