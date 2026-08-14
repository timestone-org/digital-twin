"""工控网可达性自检：连不通就响亮失败（ARCHITECTURE §7）。

⚠ 只做 TCP 层的探测，不认识任何协议：能不能握手是驱动的事，这里只回答
「这台机器的网卡与路由能不能到那个地址」——那是部署前置条件，不是应用配置。
"""

import asyncio
import contextlib
from collections.abc import Sequence
from urllib.parse import urlparse

from collector_server.apps.collect.schemas.plan import PlanSource

# 与 collector → PLC 连接的预算一致（runtime-resilience §3.1）
PROBE_TIMEOUT_S = 5.0


def endpoint_target(endpoint: str) -> tuple[str, int] | None:
    """从端点串里取出 `(host, port)`；取不出给 None。

    ⚠ 取不出**不等于不可达**：没写端口的端点（HTTP 轮询这类）本层探不了，
    交给驱动自己去连并报错，别在这里猜一个默认端口。

    Args: endpoint。
    """
    parsed = urlparse(endpoint)
    if not parsed.hostname or parsed.port is None:
        return None
    return parsed.hostname, parsed.port


async def is_reachable(host: str, port: int, *, timeout_s: float) -> bool:
    """能不能在预算内建起一条 TCP 连接。

    Args: host, port, timeout_s。
    """
    writer = None
    try:
        async with asyncio.timeout(timeout_s):
            _, writer = await asyncio.open_connection(host, port)
    except (OSError, TimeoutError):
        return False
    finally:
        if writer is not None:
            writer.close()
            with contextlib.suppress(OSError, TimeoutError):
                await writer.wait_closed()
    return True


async def unreachable_codes(
    sources: Sequence[PlanSource], *, timeout_s: float = PROBE_TIMEOUT_S
) -> list[str]:
    """并发探一遍全部数据源，返回连不通的那些的 `code`。

    Args: sources, timeout_s。
    """
    targets = [(source, endpoint_target(source.endpoint)) for source in sources]
    probes = [
        is_reachable(target[0], target[1], timeout_s=timeout_s)
        for _, target in targets
        if target is not None
    ]
    results = await asyncio.gather(*probes)
    codes = [source.code for source, target in targets if target is not None]
    return [code for code, ok in zip(codes, results, strict=True) if not ok]
