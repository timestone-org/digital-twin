"""缓存假件：进程内实现与「恒不可达」实现，均满足 `CacheLike`。

⚠ TTL 只按逻辑时钟粗略过期，不做后台清理——它足够验证「写了 TTL」这件事，
不足以验证真实过期时序。真实过期语义由打真 Redis 的集成测试锁。
"""

import json
from dataclasses import dataclass, field
from typing import Any

from lib.errors.base import DependencyUnavailable


@dataclass
class InMemoryCache:
    """进程内字典实现。"""

    store: dict[str, str] = field(default_factory=dict[str, str])
    ttl_s: dict[str, int] = field(default_factory=dict[str, int])

    async def ping(self) -> bool:
        return True

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def get_json(self, key: str) -> Any | None:
        raw = self.store.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    async def set_json(self, key: str, value: Any, *, ttl_s: int) -> None:
        self.store[key] = json.dumps(value, ensure_ascii=False)
        self.ttl_s[key] = ttl_s

    async def set_if_absent(self, key: str, value: str, *, ttl_s: int) -> bool:
        if key in self.store:
            return False
        self.store[key] = value
        self.ttl_s[key] = ttl_s
        return True

    async def delete(self, key: str) -> None:
        self.store.pop(key, None)
        self.ttl_s.pop(key, None)

    async def exists(self, key: str) -> bool:
        return key in self.store

    async def incr_in_window(self, key: str, *, window_s: int) -> int:
        count = int(self.store.get(key, "0")) + 1
        self.store[key] = str(count)
        self.ttl_s.setdefault(key, window_s)
        return count

    async def close(self) -> None:
        self.store.clear()
        self.ttl_s.clear()


@dataclass
class UnavailableCache:
    """恒不可达实现，用来验证各处的降级方向。"""

    async def ping(self) -> bool:
        return False

    async def get(self, key: str) -> str | None:
        raise self._error()

    async def get_json(self, key: str) -> Any | None:
        raise self._error()

    async def set_json(self, key: str, value: Any, *, ttl_s: int) -> None:
        raise self._error()

    async def set_if_absent(self, key: str, value: str, *, ttl_s: int) -> bool:
        raise self._error()

    async def delete(self, key: str) -> None:
        raise self._error()

    async def exists(self, key: str) -> bool:
        raise self._error()

    async def incr_in_window(self, key: str, *, window_s: int) -> int:
        raise self._error()

    async def close(self) -> None:
        return None

    @staticmethod
    def _error() -> DependencyUnavailable:
        return DependencyUnavailable(
            "缓存服务暂时不可用", context={"dependency": "redis"}
        )
