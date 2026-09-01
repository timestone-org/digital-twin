"""worker 的关停编排：停收新活 → drain → 收资源，不是启动顺序的逆序。"""

import asyncio
from typing import Any, Self

from knowledge_server.apps.knowledge.services.embedding import NullEmbedder
from knowledge_server.apps.knowledge.services.llm import NullAnswerer
from knowledge_server.container import Container, build_container
from knowledge_server.probe import IndexProbe
from knowledge_server.settings import Settings
from knowledge_server.worker import (
    WorkerRuntime,
    build_runtime,
    run_until_stopped,
)


class _Loop:
    """一条假消费循环，记下自己被怎么摆布的。"""

    def __init__(self) -> None:
        self.steps: list[str] = []
        self._stopped = asyncio.Event()

    async def run(self) -> None:
        self.steps.append("run")
        await self._stopped.wait()

    def stop(self) -> None:
        self.steps.append("stop")
        self._stopped.set()

    async def drain(self, timeout_s: float) -> None:
        assert timeout_s > 0
        self.steps.append("drain")


class _Closable:
    def __init__(self, log: list[str], name: str) -> None:
        self._log = log
        self._name = name

    async def close(self) -> None:
        self._log.append(self._name)

    async def dispose(self) -> None:
        self._log.append(self._name)

    def session(self) -> Any:
        raise RuntimeError("本用例不探测")


class _NoSession:
    async def __aenter__(self) -> Self:
        raise RuntimeError("本用例不探测")

    async def __aexit__(self, *_: object) -> None:
        return None


def _runtime(loops: tuple[_Loop, ...], closed: list[str]) -> WorkerRuntime:
    container = Container(  # pyright: ignore[reportArgumentType]
        settings=None,
        database=_Closable(closed, "database"),
        cache=_Closable(closed, "cache"),
        idempotency=None,
        objectstore=None,
        stream=None,
        sources=(),
        embedder=NullEmbedder(),
        answerer=NullAnswerer(),
        index=IndexProbe(),
    )

    async def wait() -> None:
        # ⚠ 让一次事件循环：真的 `wait_for_termination` 等的是一个 Event，
        # 那一等就把消费循环放出去跑了。直接 return 的假件不让步，
        # 消费循环于是一次都没开始过——测出来的关停顺序是假的
        await asyncio.sleep(0)

    return WorkerRuntime(
        consumers=loops,  # pyright: ignore[reportArgumentType]
        container=container,
        wait=wait,
    )


async def test_every_loop_is_stopped_then_drained() -> None:
    loop = _Loop()
    await run_until_stopped(_runtime((loop,), []))
    assert loop.steps == ["run", "stop", "drain"]


async def test_all_stop_before_any_drain() -> None:
    """⚠ 先 `stop()` 再 drain：反过来的话，drain 期间还在不停地取新消息，
    而那条循环永远排不空。"""
    first, second = _Loop(), _Loop()
    await run_until_stopped(_runtime((first, second), []))
    assert first.steps.index("stop") < second.steps.index("drain")


async def test_resources_close_after_loops_wind_down() -> None:
    """⚠ 外部存储最后关：在途的摄取还要用它们把「这一步失败了」写回文档行，
    写不进去的话，界面上那份文档会永远转圈。"""
    closed: list[str] = []
    loop = _Loop()
    await run_until_stopped(_runtime((loop,), closed))
    assert closed == ["cache", "database"]
    assert loop.steps[-1] == "drain"


async def test_resources_close_even_with_no_consumers() -> None:
    closed: list[str] = []
    await run_until_stopped(_runtime((), closed))
    assert closed == ["cache", "database"]


def test_consumers_are_an_explicit_tuple(settings: Settings) -> None:
    """⚠ 不靠 import 副作用登记：隐式登记让「这个进程在跑什么」取决于
    import 顺序，而顺序在测试里与生产里可以不同。

    ⚠ 顺手钉住「装配收的是容器不是配置」：收配置的那一版会自己再造一份容器，
    于是消费者拿到的永远是**没探测过**的索引档——而 `/capabilities` 报的是
    探测过的那一档，两边都不报错。"""

    async def wait() -> None:
        await asyncio.sleep(0)

    runtime = build_runtime(build_container(settings), wait)
    assert isinstance(runtime.consumers, tuple)
    assert len(runtime.consumers) == 1
    assert runtime.pool is not None
    runtime.pool.shutdown(wait=False)
