"""argon2 的异步通道：散列离开事件循环，且并发有界。

argon2 在 C 层释放 GIL，线程池足以让出 /verify 共用的循环，不必上进程池。
⚠ 每次计算占满 memory_cost（默认 64MiB），线程数就是这条通道的内存上限。
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor

from lib.auth import PasswordHasher


class BoundedHasher:
    """一条独占小线程池的散列通道，超出上限的调用排队等空位。"""

    def __init__(
        self, hasher: PasswordHasher, *, max_concurrency: int, name: str
    ) -> None:
        self._hasher = hasher
        self._pool = ThreadPoolExecutor(
            max_workers=max_concurrency,
            thread_name_prefix=f"argon2-{name}",
        )

    async def hash(self, raw: str) -> str:
        """算一个散列。

        Args: raw。
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._pool, self._hasher.hash, raw)

    async def verify(self, raw: str, hashed: str) -> bool:
        """校验口令。

        Args: raw, hashed。
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            self._pool, self._hasher.verify, raw, hashed
        )

    def needs_rehash(self, hashed: str) -> bool:
        """散列参数是否过期。只解析参数不计算，留在循环上。

        Args: hashed。
        """
        return self._hasher.needs_rehash(hashed)

    async def close(self) -> None:
        """停收新活并取消排队中的计算，不等已开始的那几个。"""
        self._pool.shutdown(wait=False, cancel_futures=True)
