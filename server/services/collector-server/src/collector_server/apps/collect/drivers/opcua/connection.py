"""asyncua 客户端的建连与回收，保证超时后不留半成品连接。"""

import asyncio
from typing import cast

from asyncua import Client
from asyncua.client.ua_client import UASocketProtocol

from collector_server.apps.collect.drivers.base import DriverTimeouts
from lib.logging import get_logger

_logger = get_logger("collect.driver.opcua")


async def open_session(client: Client, timeouts: DriverTimeouts) -> None:
    """建会话，超时或被取消时回收半成品。

    ⚠ `asyncio.timeout` 不能省：asyncua 只管单次请求，TCP 卡住时不会醒，这在
    工控网是常态。它的清理只收 `Exception`，超时取消绕过它，故由这里收尾。

    Args: client, timeouts。
    """
    try:
        async with asyncio.timeout(timeouts.connect_s):
            await client.connect()
    except TimeoutError:
        await _abandon(client, timeouts)
        raise
    except BaseException:
        client.disconnect_socket()
        raise


async def close_session(client: Client, timeouts: DriverTimeouts) -> None:
    """按协议拆会话，拆不掉只记日志：socket 由 asyncua 的 finally 关掉。

    Args: client, timeouts。
    """
    try:
        async with asyncio.timeout(timeouts.request_s):
            await client.disconnect()
    except Exception as error:
        _logger.warning(
            "driver_disconnect_failed", "断开会话时出错", error=error
        )


async def _abandon(client: Client, timeouts: DriverTimeouts) -> None:
    """回收超时的半成品连接。

    ⚠ 会话建起来之后只关 socket 不够：续约任务要睡满通道寿命的 0.75（默认约
    45 分钟）才醒，每次重连都留下一个，服务端会话也要等它自己过期。没有会话
    时反过来不能走协议拆除，对不应答的设备只会白等一个 request_s。

    Args: client, timeouts。
    """
    if _has_server_session(client):
        await close_session(client, timeouts)
    else:
        client.disconnect_socket()


def _has_server_session(client: Client) -> bool:
    """服务端发过会话令牌吗；后台任务总在令牌之后才起。

    Args: client。
    """
    # ⚠ asyncua 把这个属性标成非空，但 socket 建立之前与关闭之后都是 None
    protocol = cast("UASocketProtocol | None", client.uaclient.protocol)
    return protocol is not None and not protocol.authentication_token.is_null()
