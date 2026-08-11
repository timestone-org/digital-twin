#!/usr/bin/env python3
"""等 Postgres 与 Redis 真正可用，再往下跑。

⚠ 「端口通了」不等于「能用了」：Postgres 在还没进入接受查询的状态时就已经
在监听，此时连上去会拿到 `unexpected connection_lost()`——一个与「配置写错」
长得一模一样的错误。GitHub 的服务容器有 health-cmd 守着，act 没有，
所以这一步是本地与 CI 之间少数几处必须自己补齐的差异。

用法：`wait_for_deps.py <postgres-dsn> [redis-url]`
"""

from __future__ import annotations

import asyncio
import sys
import time
from collections.abc import Awaitable, Callable

import asyncpg
from redis.asyncio import Redis

TIMEOUT_S = 60.0
RETRY_INTERVAL_S = 1.0
REQUIRED_ARGS = 2


async def _postgres_ready(dsn: str) -> bool:
    url = dsn.replace("postgresql+asyncpg://", "postgresql://")
    connection = await asyncpg.connect(url, timeout=3)
    try:
        await connection.execute("SELECT 1")
    finally:
        await connection.close()
    return True


async def _redis_ready(url: str) -> bool:
    client = Redis.from_url(url, socket_timeout=3)
    try:
        await client.ping()
    finally:
        await client.aclose()
    return True


Probe = Callable[[str], Awaitable[bool]]


async def _await_ready(name: str, probe: Probe, target: str) -> None:
    deadline = time.monotonic() + TIMEOUT_S
    last = ""
    while time.monotonic() < deadline:
        # 探测期间任何异常都只意味着「还没好」，不该把等待变成失败
        try:
            await probe(target)
        except Exception as error:
            last = f"{type(error).__name__}: {error}"
            await asyncio.sleep(RETRY_INTERVAL_S)
            continue
        sys.stdout.write(f"{name} 就绪\n")
        return
    sys.stderr.write(f"{name} 在 {TIMEOUT_S:.0f}s 内没起来：{last}\n")
    raise SystemExit(1)


async def main() -> None:
    """按参数依次等待各个依赖。"""
    await _await_ready("Postgres", _postgres_ready, sys.argv[1])
    if len(sys.argv) > REQUIRED_ARGS:
        await _await_ready("Redis", _redis_ready, sys.argv[2])


if __name__ == "__main__":
    if len(sys.argv) < REQUIRED_ARGS:
        sys.stderr.write("用法：wait_for_deps.py <postgres-dsn> [redis-url]\n")
        raise SystemExit(2)
    asyncio.run(main())
