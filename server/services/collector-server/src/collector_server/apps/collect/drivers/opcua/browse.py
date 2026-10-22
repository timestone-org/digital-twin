"""OPC UA 原生续读与有界兼容缓存，游标属于一个现场会话。"""

import asyncio
import contextlib
from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Protocol, cast
from uuid import uuid4

from asyncua import Client, ua

from collector_server.apps.collect.drivers.base import (
    BrowseContinuationInvalid,
    BrowsePageTooLarge,
)
from collector_server.apps.collect.drivers.opcua.mapping import node_id_of
from collector_server.clock import Clock
from collectwire import DEFAULT_BROWSE_LIMIT, MAX_BROWSE_LIMIT
from lib.logging import get_logger

MAX_BROWSE_CURSORS = 32
MAX_BUFFERED_REFERENCES = 20_000
BROWSE_CURSOR_TTL_MS = 60_000
_logger = get_logger("collect.driver.opcua.browse")


class BrowseSession(Protocol):
    """驱动使用的协议库服务面。"""

    async def browse(
        self, parameters: ua.BrowseParameters
    ) -> list[ua.BrowseResult]: ...

    async def browse_next(
        self, parameters: ua.BrowseNextParameters
    ) -> list[ua.BrowseResult]: ...


@dataclass(frozen=True)
class _Cursor:
    parent: str | None
    limit: int
    expires_ms: int
    point: bytes | None
    references: tuple[ua.ReferenceDescription, ...] = ()


@dataclass(frozen=True)
class ReferencePage:
    """一页尚未读取类型的引用描述。"""

    references: Sequence[ua.ReferenceDescription]
    continuation_token: str | None


class BrowsePager:
    """按页取引用，自动回收原生续读点和兼容缓存。"""

    def __init__(
        self,
        client: Client,
        *,
        clock: Clock,
        timeout_s: float,
        release_timeout_s: float,
    ) -> None:
        self._session = cast(BrowseSession, client.uaclient)
        self._clock = clock
        self._timeout_s = timeout_s
        self._release_timeout_s = release_timeout_s
        self._cursors: dict[str, _Cursor] = {}
        self._cleanup_task: asyncio.Task[None] | None = None

    async def page(
        self,
        parent: str | None,
        *,
        limit: int = DEFAULT_BROWSE_LIMIT,
        continuation_token: str | None = None,
    ) -> ReferencePage:
        """取一页，续读不重新浏览父节点。"""
        if not 1 <= limit <= MAX_BROWSE_LIMIT:
            raise ValueError("浏览页大小必须在 1 到 500 之间")
        await self._prune()
        cursor = self._take(parent, limit, continuation_token)
        if cursor is not None and cursor.references:
            return await self._split(cursor, cursor.references)
        if cursor is None:
            await self._make_room()
        point = cursor.point if cursor is not None else None
        try:
            async with asyncio.timeout(self._timeout_s):
                results = await self._request(parent, limit, point)
        except BaseException as error:
            await self._release_points([point] if point else [])
            if isinstance(error, ua.uaerrors.BadContinuationPointInvalid):
                raise BrowseContinuationInvalid(
                    "设备浏览游标已失效，请刷新文件夹重新浏览"
                ) from error
            raise
        if not results:
            return ReferencePage((), None)
        try:
            return await self._result_page(results[0], parent, limit)
        except BaseException:
            await self._release_points([point] if point else [])
            raise

    async def _result_page(
        self,
        result: ua.BrowseResult,
        parent: str | None,
        limit: int,
    ) -> ReferencePage:
        try:
            result.StatusCode.check()
        except Exception as error:
            await self._release_points(
                [result.ContinuationPoint] if result.ContinuationPoint else []
            )
            if isinstance(error, ua.uaerrors.BadContinuationPointInvalid):
                raise BrowseContinuationInvalid(
                    "设备浏览游标已失效，请刷新文件夹重新浏览"
                ) from error
            raise
        state = _Cursor(
            parent,
            limit,
            self._clock() + BROWSE_CURSOR_TTL_MS,
            result.ContinuationPoint,
        )
        return await self._split(state, result.References)

    def _take(
        self, parent: str | None, limit: int, token: str | None
    ) -> _Cursor | None:
        if token is None:
            return None
        cursor = self._cursors.get(token)
        if cursor is None or cursor.parent != parent or cursor.limit != limit:
            raise BrowseContinuationInvalid(
                "浏览游标已失效，请刷新文件夹重新浏览"
            )
        return self._cursors.pop(token)

    async def _request(
        self,
        parent: str | None,
        limit: int,
        point: bytes | None,
    ) -> list[ua.BrowseResult]:
        if point:
            return await self._session.browse_next(
                ua.BrowseNextParameters(
                    ContinuationPoints=[ua.ByteString(point)],
                    ReleaseContinuationPoints=cast(ua.Boolean, False),
                )
            )
        description = ua.BrowseDescription(
            NodeId_=(
                ua.NodeId(ua.Int32(ua.ObjectIds.ObjectsFolder))
                if parent is None
                else node_id_of(parent)
            ),
            BrowseDirection_=ua.BrowseDirection.Forward,
            ReferenceTypeId=ua.NodeId(
                ua.Int32(ua.ObjectIds.HierarchicalReferences)
            ),
            IncludeSubtypes=cast(ua.Boolean, True),
            ResultMask=ua.UInt32(ua.BrowseResultMask.All),
        )
        return await self._session.browse(
            ua.BrowseParameters(
                View=ua.ViewDescription(
                    Timestamp=cast(ua.UtcTime, ua.get_win_epoch())
                ),
                NodesToBrowse=[description],
                RequestedMaxReferencesPerNode=ua.UInt32(limit),
            )
        )

    async def _split(
        self,
        cursor: _Cursor,
        references: Sequence[ua.ReferenceDescription],
    ) -> ReferencePage:
        buffered = sum(len(item.references) for item in self._cursors.values())
        if len(references) + buffered > MAX_BUFFERED_REFERENCES:
            await self._release_points([cursor.point] if cursor.point else [])
            raise BrowsePageTooLarge(
                "设备返回的单层节点超过浏览容量，请选择更小文件夹或导入点表"
            )
        taken = references[: cursor.limit]
        remaining = tuple(references[cursor.limit :])
        token = None
        if remaining or cursor.point:
            try:
                await self._make_room()
            except BaseException:
                await self._release_points(
                    [cursor.point] if cursor.point else []
                )
                raise
            token = uuid4().hex
            self._cursors[token] = replace(
                cursor,
                references=remaining,
                expires_ms=self._clock() + BROWSE_CURSOR_TTL_MS,
            )
            if self._cleanup_task is None or self._cleanup_task.done():
                self._cleanup_task = asyncio.create_task(self._expire())
        return ReferencePage(taken, token)

    async def _make_room(self) -> None:
        while len(self._cursors) >= MAX_BROWSE_CURSORS:
            oldest = next(iter(self._cursors))
            await self.release(oldest)

    async def release(self, token: str) -> None:
        """归还调用方不再使用的续读点。"""
        cursor = self._cursors.pop(token, None)
        if cursor is not None and cursor.point:
            await self._release_points([cursor.point])

    async def _prune(self) -> None:
        expired = [
            token
            for token, cursor in self._cursors.items()
            if cursor.expires_ms <= self._clock()
        ]
        cursors = [self._cursors.pop(token) for token in expired]
        await self._release_points(
            [cursor.point for cursor in cursors if cursor.point]
        )

    async def _expire(self) -> None:
        while self._cursors:
            next_expiry = min(
                cursor.expires_ms for cursor in self._cursors.values()
            )
            await asyncio.sleep(
                max(0.001, (next_expiry - self._clock()) / 1000)
            )
            await self._prune()

    async def _release_points(self, points: list[bytes]) -> None:
        if not points:
            return
        try:
            async with asyncio.timeout(self._release_timeout_s):
                await self._session.browse_next(
                    ua.BrowseNextParameters(
                        ContinuationPoints=[
                            ua.ByteString(point) for point in points
                        ],
                        ReleaseContinuationPoints=cast(ua.Boolean, True),
                    )
                )
        except Exception as error:
            _logger.warning(
                "browse_release_failed",
                "浏览续读点释放失败",
                error_type=type(error).__name__,
            )

    async def close(self) -> None:
        """停止回收任务并归还当前会话持有的全部续读点。"""
        task, self._cleanup_task = self._cleanup_task, None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        points = [
            cursor.point for cursor in self._cursors.values() if cursor.point
        ]
        self._cursors.clear()
        await self._release_points(points)
