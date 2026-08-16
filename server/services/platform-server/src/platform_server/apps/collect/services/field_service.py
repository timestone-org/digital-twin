"""要往现场跑一趟的四件事：连通性测试、浏览一层、一次收齐一棵子树、下发写值。

⚠ 四件都由 collector 执行，platform 只发命令（ADR-0001 理由三）。每一件都先
把要用的行读出来、放掉只读事务，再去总线上等——事务里禁止外部 IO。
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from platform_server.apps.collect.schemas import (
    BrowseOut,
    ConnectivityOut,
    SubtreeOut,
    WriteOut,
)
from platform_server.apps.collect.services import (
    point_service,
    source_service,
)
from platform_server.apps.collect.services.command_bus import CommandBus
from platform_server.apps.collect.services.presenters import (
    to_browse_item_out,
    to_subtree_item_out,
)
from platform_server.apps.collect.services.transactions import (
    release_read_transaction,
)
from timeseries import compose_node_key

_logger = get_logger("platform.collect.field")


async def test_source(
    session: AsyncSession, *, bus: CommandBus, source_id: uuid.UUID
) -> ConnectivityOut:
    """连通性测试。不可达是一个**结论**，不是异常。

    Args: session, bus, source_id。
    """
    source = await source_service.require_source(session, source_id)
    resolved = source.id
    await release_read_transaction(session)
    reason = await bus.probe(resolved)
    _logger.info(
        "collect_source_probed",
        "连通性测试完成",
        source_id=str(resolved),
        is_reachable=reason is None,
    )
    return ConnectivityOut(
        source_id=resolved,
        is_reachable=reason is None,
        detail=None if reason is None else _reachability_detail(reason),
    )


async def browse_source(
    session: AsyncSession,
    *,
    bus: CommandBus,
    source_id: uuid.UUID,
    parent: str | None,
) -> BrowseOut:
    """浏览地址空间。协议不支持就明确报错，**不回空列表**。

    Args: session, bus, source_id, parent。
    """
    source = await source_service.require_source(session, source_id)
    resolved = source.id
    await release_read_transaction(session)
    entries = await bus.browse(resolved, parent)
    return BrowseOut(items=[to_browse_item_out(item) for item in entries])


async def browse_subtree(
    session: AsyncSession,
    *,
    bus: CommandBus,
    source_id: uuid.UUID,
    parent: str | None,
) -> SubtreeOut:
    """一次收齐一棵子树，勾上层节点用。

    ⚠ 不限条数，只受这次请求的时间预算约束。到点没走完只标 `is_truncated`
    而不抛：收到一半的地址空间仍然有用，但用户必须知道它是一半。
    Args: session, bus, source_id, parent。
    """
    source = await source_service.require_source(session, source_id)
    resolved = source.id
    await release_read_transaction(session)
    outcome = await bus.browse_subtree(resolved, parent)
    _logger.info(
        "collect_subtree_browsed",
        "子树浏览完成",
        source_id=str(resolved),
        item_count=len(outcome.entries),
        is_truncated=outcome.is_truncated,
    )
    return SubtreeOut(
        items=[to_subtree_item_out(item) for item in outcome.entries],
        is_truncated=outcome.is_truncated,
    )


async def write_point(
    session: AsyncSession,
    *,
    bus: CommandBus,
    point_id: uuid.UUID,
    value: object,
) -> WriteOut:
    """向现场下发一个写值。

    ⚠ 这条链路上**没有任何一层重试**：写超时不代表没写成功，重试可能向 PLC
    下发两次。调用方要重试就必须带同一个幂等键，由幂等层挡住
    （runtime-resilience §2 与 api-contract §7）。
    Args: session, bus, point_id, value。
    """
    point = await point_service.require_point(session, point_id)
    source_id, code = point.source_id, point.code
    await release_read_transaction(session)
    node_key = compose_node_key(source_id, code)
    await bus.write(source_id, code, value)
    # ⚠ 审计只记「谁写了哪个点位」，不记值：写值的载荷可能是配方参数一类的
    # 敏感数据，而请求体全文禁入日志（observability §3）
    _logger.info("collect_point_written", "写值已下发", point_id=str(point_id))
    return WriteOut(point_id=point_id, node_key=node_key, is_written=True)


def _reachability_detail(reason: str) -> str:
    """把采集侧的 `reason` 翻成一句用户看得懂的话。

    Args: reason。
    """
    known = {
        "source_offline": "采集侧还没连上这个数据源",
        "unknown_protocol": "采集侧没有这个协议的驱动",
        "driver_failed": "驱动连接现场时失败",
        "collector_unreachable": "采集侧没有答复，请先确认采集进程在运行",
    }
    return known.get(reason, "采集侧无法访问这个数据源")
