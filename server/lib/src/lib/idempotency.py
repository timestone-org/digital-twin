"""幂等键：按 `(端点, 幂等键, 调用者)` 缓存首次结果。

已确认失败释放占位。执行结果无法确认时保留占位，避免再次执行同一操作。

⚠ 没给键就照常执行：调用方给不给键是它的自由，端点只负责「支持」，
**没给键就没有幂等保证**。
"""

import asyncio
import hashlib
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from pydantic import BaseModel

from lib.cache.protocol import CacheLike
from lib.errors import AppError, Conflict, DependencyUnavailable
from lib.logging import get_logger
from lib.utils.ids import uuid7

# 重试窗口可能跨越一次发布，故结果至少留 24h
RESULT_TTL_S = 86_400
# 「正在处理」的占位比结果短得多：进程崩在中途时，这个键必须自己过期，
# 否则同一个幂等键会被永久拒绝，而调用方无从得知该等多久。
CLAIM_TTL_S = 300
_UNCONFIRMED_MARKER = "outcome_unknown"

_logger = get_logger("lib.idempotency")


@dataclass(frozen=True)
class IdempotencyStore:
    """幂等结果的缓存面。

    `namespace` 把键分到各自的命名空间里——共用一个缓存实例的两个服务，
    同一个端点名撞上同一个幂等键时会互相返回对方的结果。
    """

    cache: CacheLike
    namespace: str
    should_reserve_full_window: bool = False

    async def lookup_result[ResultT: BaseModel](
        self,
        *,
        endpoint: str,
        key: str,
        caller: UUID,
        model: type[ResultT],
    ) -> ResultT | None:
        """只读首次成功结果，不认领或执行。

        Args: endpoint, key, caller, model。
        """
        cached: Any | None = await self.cache.get_json(
            self._result_key(endpoint, key, caller)
        )
        return None if cached is None else model.model_validate(cached)

    async def run_once[ResultT: BaseModel](
        self,
        *,
        endpoint: str,
        key: str | None,
        caller: UUID,
        model: type[ResultT],
        action: Callable[[], Awaitable[ResultT]],
    ) -> ResultT:
        """带幂等键就只执行一次，重复请求直接返回首次结果。

        Args: endpoint, key, caller, model, action。
        """
        if key is None:
            return await action()
        cached = await self.lookup_result(
            endpoint=endpoint, key=key, caller=caller, model=model
        )
        if cached is not None:
            return cached
        claim_key, owner = await self._claim(
            endpoint=endpoint, key=key, caller=caller
        )
        try:
            result = await action()
        except asyncio.CancelledError:
            if self.should_reserve_full_window:
                await self._retain_unconfirmed(claim_key, owner, endpoint)
            raise
        except Exception as error:
            if self._should_retain_failure(error):
                await self._retain_unconfirmed(claim_key, owner, endpoint)
            else:
                await self.cache.delete_if_owner(claim_key, owner)
            raise
        await self._remember_success(
            self._result_key(endpoint, key, caller), endpoint, result
        )
        return result

    def _should_retain_failure(self, error: Exception) -> bool:
        """安全窗内仅释放已经确认未执行的操作。Args: error。"""
        if isinstance(error, AppError):
            return error.is_outcome_unknown or (
                self.should_reserve_full_window
                and not error.is_execution_rejected
            )
        return self.should_reserve_full_window

    async def _remember_success(
        self, result_key: str, endpoint: str, result: BaseModel
    ) -> None:
        """缓存已确认的成功回执。Args: result_key, endpoint, result。"""
        try:
            await self.cache.set_json(
                result_key,
                result.model_dump(mode="json", by_alias=True),
                ttl_s=RESULT_TTL_S,
            )
        except DependencyUnavailable as error:
            _logger.warning(
                "idempotency_result_store_failed",
                "幂等结果没存上，本次仍按成功返回",
                endpoint=endpoint,
                error=error,
            )

    async def _retain_unconfirmed(
        self, claim_key: str, owner: str, endpoint: str
    ) -> None:
        """保留本次占位并标明结果未知。Args: claim_key, owner, endpoint。"""
        try:
            if await self.cache.renew_if_owner(
                claim_key,
                owner,
                ttl_s=RESULT_TTL_S,
                replacement=_UNCONFIRMED_MARKER,
            ):
                return
        except DependencyUnavailable:
            # 核验失败时保留仍在 Redis 的原始占位，首个请求仍报告真实结果。
            pass
        _logger.warning(
            "idempotency_outcome_retention_failed",
            "未能延长结果未知的幂等占位",
            endpoint=endpoint,
        )

    async def _claim(
        self, *, endpoint: str, key: str, caller: UUID
    ) -> tuple[str, str]:
        """占位，返回缓存键和本次持有者。Args: endpoint, key, caller。"""
        claim_key = self._claim_key(endpoint, key, caller)
        owner = str(uuid7())
        ttl_s = RESULT_TTL_S if self.should_reserve_full_window else CLAIM_TTL_S
        if await self.cache.set_if_absent(claim_key, owner, ttl_s=ttl_s):
            return claim_key, owner
        if await self.cache.get(claim_key) == _UNCONFIRMED_MARKER:
            raise Conflict("同一幂等键的上次操作结果未确认，请先核对操作结果")
        if self.should_reserve_full_window:
            raise Conflict("同一幂等键的操作仍在处理或结果未确认，请先核对")
        raise Conflict("相同幂等键的请求正在处理中，请稍后重试")

    def _result_key(self, endpoint: str, key: str, caller: UUID) -> str:
        return f"{self.namespace}:idem:result:{_digest(endpoint, key, caller)}"

    def _claim_key(self, endpoint: str, key: str, caller: UUID) -> str:
        return f"{self.namespace}:idem:claim:{_digest(endpoint, key, caller)}"


def _digest(endpoint: str, key: str, caller: UUID) -> str:
    """把三元组压成定长摘要。

    ⚠ 幂等键由调用方给，可能很长也可能带冒号——直接拼进缓存键会撞上键名冲突
    与长度上限。
    Args: endpoint, key, caller。
    """
    raw = json.dumps([endpoint, key, str(caller)], separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
