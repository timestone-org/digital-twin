"""跑算子的进程池，以及它的超时与换池。

⚠ 用子进程是为了**资源隔离**，不是沙箱：不可信代码根本不进来
（docs/MODELING_DESIGN.md §9.3）。收益是 sklearn / numpy 的内存不在事件循环
那个进程里累积，且 BLAS 线程不与消费循环抢核——线程池救不了 GIL。
"""

import asyncio
from collections.abc import Callable
from concurrent.futures import Executor, ProcessPoolExecutor
from typing import Any

from platform_server.apps.modeling.services.node_task import (
    NodePayload,
    run_node_payload,
)


class NodePool:
    """算子用的进程池，超时或整池损坏后换新。

    ⚠ `ProcessPoolExecutor` 没有公开的「杀掉在跑任务」的口：cancel 只对还没
    开跑的生效，`shutdown(cancel_futures=True)` 也一样。超时被掐断的算子会
    继续在子进程里烧 CPU，而单工池的下一个任务要排在它后面——僵尸拟合等于把
    整个建模面堵死。唯一的出路是杀进程、换新池；`_processes` 是私有面，
    算子无副作用，杀了没有半成品要收拾。
    """

    def __init__(self, factory: Callable[[], Executor] | None = None) -> None:
        self._factory = factory or (lambda: ProcessPoolExecutor(max_workers=1))
        self._executor = self._factory()

    @property
    def executor(self) -> Executor:
        """当前可用的执行器。"""
        return self._executor

    def recycle(self) -> None:
        """杀掉旧池里的子进程并换新池。超时与整池损坏都走它。"""
        old = self._executor
        self._executor = self._factory()
        self._terminate(old)

    def shutdown(self) -> None:
        """进程收摊时释放当前池。"""
        self._terminate(self._executor)

    @staticmethod
    def _terminate(executor: Executor) -> None:
        # ⚠ 先拍成列表再遍历：池坏掉时管理线程正在清这本字典，边清边遍历会抛
        # 「dictionary changed size」，而这一句正跑在异常出口上
        for process in list(getattr(executor, "_processes", {}).values()):
            process.kill()
        executor.shutdown(wait=False, cancel_futures=True)


class PooledRunner:
    """把算子交给进程池跑，并给它一个时限。

    ⚠ 掐断的只是**等待**，算子还在子进程里烧：所以超时后必须换池，否则单工池
    被僵尸任务占着，下一个节点永远排不上。
    """

    def __init__(self, pool: NodePool, *, timeout_s: float) -> None:
        self._pool = pool
        self._timeout_s = timeout_s

    async def run(self, payload: NodePayload) -> dict[str, Any]:
        """跑一个算子；超时抛 `TimeoutError` 并换池。

        Args: payload。
        """
        loop = asyncio.get_running_loop()
        future = loop.run_in_executor(
            self._pool.executor, run_node_payload, payload
        )
        try:
            async with asyncio.timeout(self._timeout_s):
                return await future
        except TimeoutError:
            self._pool.recycle()
            raise
        except Exception:
            # 子进程猝死会把整池永久标记为坏：不换池的话，这个进程往后每一次
            # 提交都秒抛，整个建模面就此哑掉
            self._pool.recycle()
            raise
