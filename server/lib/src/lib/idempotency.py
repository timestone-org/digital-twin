"""幂等键：按 `(端点, 幂等键, 调用者)` 缓存首次结果。

⚠ 只缓存**成功**结果。失败也缓存的话，一次偶发的下游超时会被幂等键钉死成
永久失败，而调用方换个键重试才好——那等于要求调用方知道我们的实现细节。

⚠ 没给键就照常执行：调用方给不给键是它的自由，端点只负责「支持」，
**没给键就没有幂等保证**。
"""

import hashlib
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from pydantic import BaseModel

from lib.cache.protocol import CacheLike
from lib.errors import Conflict

# 重试窗口可能跨越一次发布，故结果至少留 24h
RESULT_TTL_S = 86_400
# 「正在处理」的占位比结果短得多：进程崩在中途时，这个键必须自己过期，
# 否则同一个幂等键会被永久拒绝，而调用方无从得知该等多久。
CLAIM_TTL_S = 300
_CLAIM_MARKER = "pending"


@dataclass(frozen=True)
class IdempotencyStore:
    """幂等结果的缓存面。

    `namespace` 把键分到各自的命名空间里——共用一个缓存实例的两个服务，
    同一个端点名撞上同一个幂等键时会互相返回对方的结果。
    """

    cache: CacheLike
    namespace: str

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
        cached: Any | None = await self.cache.get_json(
            self._result_key(endpoint, key, caller)
        )
        if cached is not None:
            return model.model_validate(cached)
        await self._claim(endpoint=endpoint, key=key, caller=caller)
        try:
            result = await action()
        except Exception:
            # 失败要放开占位，否则调用方拿同一个键永远重试不了
            await self.cache.delete(self._claim_key(endpoint, key, caller))
            raise
        await self.cache.set_json(
            self._result_key(endpoint, key, caller),
            # ⚠ 必须 by_alias：出参带别名时，不按别名存回放出来的就是另一套
            # 字段名，而调用方只在重试那一次看到它
            result.model_dump(mode="json", by_alias=True),
            ttl_s=RESULT_TTL_S,
        )
        return result

    async def _claim(self, *, endpoint: str, key: str, caller: UUID) -> None:
        """占坑。占不到说明同键请求正在处理中，直接冲突而不是并发执行两次。

        Args: endpoint, key, caller。
        """
        claimed = await self.cache.set_if_absent(
            self._claim_key(endpoint, key, caller),
            _CLAIM_MARKER,
            ttl_s=CLAIM_TTL_S,
        )
        if not claimed:
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
