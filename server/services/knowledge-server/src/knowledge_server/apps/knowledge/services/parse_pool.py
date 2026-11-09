"""解析用的单工进程池，卡住的那一份可以连进程一起换掉。

⚠ `ProcessPoolExecutor` 没有「杀掉在跑任务」的口：解析超时只是不再等它，子进程
仍在跑那一份，而单工池里排在后面的每一份都在队里耗光自己的超时、被记成「解析
超时」。所以超时之后整池换新，旧池的子进程当场杀掉。
"""

import multiprocessing
import threading
from collections.abc import Callable
from concurrent.futures import Executor, Future, ProcessPoolExecutor

from lib.logging import get_logger

_logger = get_logger("knowledge.parse_pool")

# 子进程的起法。⚠ 用 spawn 不用 fork：worker 里早有别的线程在跑（事件循环的
# 线程池、执行器的管理线程），多线程进程里 fork 出来的子进程可能直接死锁在
# 一把被复制过去的锁上
_START_METHOD = "spawn"


def _fresh() -> ProcessPoolExecutor:
    """一池新的单工进程池。"""
    return ProcessPoolExecutor(
        max_workers=1, mp_context=multiprocessing.get_context(_START_METHOD)
    )


class RecyclingPool(Executor):
    """单工进程池；`recycle` 把在跑的那一份连同进程一起丢掉。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._inner = _fresh()

    def submit[**P, T](
        self, fn: Callable[P, T], /, *args: P.args, **kwargs: P.kwargs
    ) -> Future[T]:
        """交给此刻那一池去跑。

        Args: fn, args, kwargs。
        """
        with self._lock:
            return self._inner.submit(fn, *args, **kwargs)

    def recycle(self) -> None:
        """换一池新的，并杀掉旧池里的子进程。

        ⚠ 先取子进程快照再换池：新池的进程是第一次提交时才起的，快照里只会有
        旧池那几个。⚠ 认的是本进程的全部 multiprocessing 子进程——worker 里
        只有解析池用它，其余外部程序走的是 subprocess。
        """
        with self._lock:
            stale = multiprocessing.active_children()
            old, self._inner = self._inner, _fresh()
        old.shutdown(wait=False, cancel_futures=True)
        for one in stale:
            one.kill()
        _logger.warning(
            "knowledge_parse_pool_recycled",
            "解析超时，已换新进程池",
            killed=len(stale),
        )

    def shutdown(
        self, wait: bool = True, *, cancel_futures: bool = False
    ) -> None:
        """关掉此刻那一池。

        Args: wait, cancel_futures。
        """
        with self._lock:
            self._inner.shutdown(wait=wait, cancel_futures=cancel_futures)
