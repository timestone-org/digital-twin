"""固定窗口限流。计数在 Redis 上做，多副本共享同一份配额。"""

from dataclasses import dataclass

from lib.cache.client import Cache
from lib.errors.base import RateLimited


@dataclass(frozen=True)
class FixedWindowLimiter:
    """一个限流场景。`namespace` 由服务侧给，`lib` 不认识具体场景。"""

    cache: Cache
    namespace: str
    limit: int
    window_s: int
    message: str = "请求过于频繁，请稍后再试"

    async def hit(self, identity: str) -> int:
        """计一次并返回窗口内累计；超限抛 RateLimited。

        Args: identity（限流主体，如客户端 IP 或用户名）。
        """
        count = await self.cache.incr_in_window(
            self._key(identity), window_s=self.window_s
        )
        if count > self.limit:
            raise RateLimited(
                self.message,
                context={
                    "namespace": self.namespace,
                    "limit": self.limit,
                    "window_s": self.window_s,
                },
            )
        return count

    async def reset(self, identity: str) -> None:
        """清掉某个主体的计数（如登录成功后清失败次数）。

        Args: identity。
        """
        await self.cache.delete(self._key(identity))

    def _key(self, identity: str) -> str:
        return f"ratelimit:{self.namespace}:{identity}"
