"""按页遍历子树，以时间和节点预算限制现场负载及应答大小。"""

from collections import deque
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Protocol

from collector_server.apps.collect.drivers.base import BrowseItem, BrowsePage
from collector_server.clock import Clock, utc_now_ms
from collectwire import DEFAULT_BROWSE_LIMIT, MAX_SUBTREE_ITEMS
from lib.logging import get_logger

_logger = get_logger("collect.subtree")


# 浏览一层：入参是父节点的寻址串，None 表示从根开始
class Browse(Protocol):
    async def __call__(
        self,
        parent: str | None,
        *,
        limit: int = DEFAULT_BROWSE_LIMIT,
        continuation_token: str | None = None,
    ) -> BrowsePage: ...


Release = Callable[[str], Awaitable[None]]

# 墙钟到点前留出的余量：走完还得把应答编码回 Redis，掐着点收工等于白跑
DEADLINE_RESERVE_MS = 500


@dataclass(frozen=True)
class SubtreeEntry:
    """子树里的一项，外加它挂在谁下面。

    ⚠ `parent` 不能省：调用方要靠它把这一坨平铺的结果重新拼回树，没有它界面
    只能摆出一张没有层级的清单。
    """

    parent: str | None
    item: BrowseItem


@dataclass(frozen=True)
class SubtreeResult:
    """一次子树遍历的结果。"""

    entries: tuple[SubtreeEntry, ...]
    is_truncated: bool


@dataclass
class _Walk:
    """一次遍历的账本：待展开的队列、去重表与墙钟的余量。"""

    deadline_ms: int
    clock: Clock
    pending: deque[tuple[str | None, str | None]] = field(
        default_factory=deque[tuple[str | None, str | None]]
    )
    seen: set[str] = field(default_factory=set[str])
    entries: list[SubtreeEntry] = field(default_factory=list[SubtreeEntry])
    expansions: int = 0
    is_truncated: bool = False

    def is_spent(self) -> bool:
        """这次请求的时间还够不够再打一趟设备。"""
        return self.clock() + DEADLINE_RESERVE_MS >= self.deadline_ms

    def absorb(
        self, parent: str | None, children: Sequence[BrowseItem]
    ) -> None:
        """收下一层的结果；还能往下走的排队等着。

        ⚠ 按寻址串去重：地址空间允许同一个节点挂在多处，不去重就会绕着环一直
        走下去，而每一圈都是真打设备。这也是遍历会终止的全部理由。
        Args: parent, children。
        """
        self.expansions += 1
        for child in children:
            if child.address in self.seen:
                continue
            if len(self.entries) >= MAX_SUBTREE_ITEMS:
                self.is_truncated = True
                break
            self.seen.add(child.address)
            self.entries.append(SubtreeEntry(parent=parent, item=child))
            if not child.is_variable and child.has_children:
                self.pending.append((child.address, None))


async def walk_subtree(
    browse: Browse,
    root: str | None,
    *,
    deadline_ms: int,
    clock: Clock = utc_now_ms,
    release: Release | None = None,
) -> SubtreeResult:
    """从 `root` 逐层往下走，把整棵子树平铺回来。

    ⚠ 第一层拉不动就抛：那是「这个数据源浏览不了」，与「里面有一枝拉不动」
    是两回事，合并成一个空结果会让人去查设备上根本不存在的问题。深处某一枝
    失败只按截断记，其余照走。
    Args: browse, root, deadline_ms（发起方给的绝对墙钟）, clock。
    """
    walk = _Walk(deadline_ms=deadline_ms, clock=clock)
    walk.pending.append((root, None))
    if root is not None:
        walk.seen.add(root)
    try:
        while walk.pending:
            if walk.is_spent() or len(walk.entries) >= MAX_SUBTREE_ITEMS:
                walk.is_truncated = True
                break
            await _advance(walk, browse, release)
    finally:
        if release is not None:
            for _, token in walk.pending:
                if token is not None:
                    await release(token)
    return SubtreeResult(
        entries=tuple(walk.entries), is_truncated=walk.is_truncated
    )


async def _advance(
    walk: _Walk, browse: Browse, release: Release | None
) -> None:
    parent, token = walk.pending.popleft()
    try:
        page = await browse(
            parent, limit=DEFAULT_BROWSE_LIMIT, continuation_token=token
        )
        walk.absorb(parent, page.items)
        if page.continuation_token is not None:
            walk.pending.appendleft((parent, page.continuation_token))
    except Exception as error:
        if walk.expansions == 0:
            raise
        _logger.warning(
            "subtree_branch_failed",
            "子树里有一枝没拉回来，按截断处理",
            error_type=type(error).__name__,
        )
        walk.is_truncated = True
    finally:
        if release is not None and token is not None:
            await release(token)
