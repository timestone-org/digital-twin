"""开放模型的进程隔离与请求时限。"""

import asyncio
import multiprocessing
from collections.abc import AsyncGenerator, Callable
from concurrent.futures import BrokenExecutor, ProcessPoolExecutor
from contextlib import asynccontextmanager
from functools import partial

from lib.errors import AppError, DependencyUnavailable
from lib.objectstore import ObjectStore
from platform_server.apps.modeling.services import artifact_io
from platform_server.apps.modeling.services.inference_task import (
    ArtifactIdentity,
    Prediction,
    RequiredArtifact,
    ScoreRows,
    score,
)
from platform_server.apps.modeling.services.run_pool import NodePool

# 留出边缘 25 秒上限内的编解码与记录时间
INFERENCE_TIMEOUT_S = 20.0


@asynccontextmanager
async def _budget() -> AsyncGenerator[None]:
    """给排队、取制品与计算合用一个时限。"""
    try:
        async with asyncio.timeout(INFERENCE_TIMEOUT_S):
            yield
    except (TimeoutError, BrokenExecutor) as error:
        raise DependencyUnavailable("模型推理暂时不可用，请稍后重试") from error


class InferencePool:
    """一个 API 副本的推理工作进程，首次使用时启动。"""

    def __init__(self) -> None:
        self._pool: NodePool | None = None
        self._closed = False
        self._download = asyncio.Semaphore(1)

    async def _run[Result](
        self, work: Callable[[], Result | AppError]
    ) -> Result:
        if self._closed:
            raise DependencyUnavailable("模型推理进程正在停止")
        if self._pool is None:
            self._pool = NodePool(
                lambda: ProcessPoolExecutor(
                    max_workers=1,
                    mp_context=multiprocessing.get_context("spawn"),
                )
            )
        result = await self._pool.run(work)
        if isinstance(result, AppError):
            raise result
        return result

    async def calculate[Result](
        self, work: Callable[[], Result | AppError]
    ) -> Result:
        """运行冻结的规则计算。Args: work。"""
        async with _budget():
            return await self._run(work)

    async def predict(
        self,
        rows: ScoreRows,
        identity: ArtifactIdentity | None,
        store: ObjectStore | None,
    ) -> Prediction:
        """复用模型，按需加载制品。Args: rows, identity, store。"""
        async with _budget():
            result = await self._run(partial(score, rows, identity))
            if not isinstance(result, RequiredArtifact):
                return result
            if identity is None or store is None:
                raise RuntimeError("模型工作进程请求了未绑定的制品")
            async with self._download:
                payload = await artifact_io.read_bytes(store, identity.key)
                result = await self._run(
                    partial(score, rows, identity, payload)
                )
                if isinstance(result, RequiredArtifact):
                    raise RuntimeError("提供制品后仍无法运行模型")
                return result

    async def close(self) -> None:
        """停止工作进程，丢弃其模型缓存。"""
        self._closed = True
        if self._pool is not None:
            self._pool.shutdown()
            self._pool = None
