"""命令总线的发起端：浏览、连通性测试、寻址串校验、下发写值。

⚠ **平台侧不建任何现场连接**。浏览与写值都由持有会话的 collector 执行，
platform 只发命令、等回值（ADR-0001 理由三）——自己也开一条连接，就是在物理
设备上叠加会话，而工业设备的会话上限往往只有个位数。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, cast

from lib.errors import DependencyUnavailable
from lib.logging import get_logger
from lib.utils.ids import uuid7
from lib.utils.timeutils import utcnow
from platform_server.apps.collect.errors import (
    BrowseUnsupported,
    CollectorUnreachable,
    CommandFailed,
    SourceOffline,
    WriteUnsupported,
)
from platform_server.apps.collect.services.command_transport import (
    TRACEPARENT_KEY,
    CommandTransport,
    current_traceparent,
)

_logger = get_logger("platform.collect.command")

# 动作名是稳定字面量，与 collector-server 的 `bus/consumer.py` 逐字一致
ACTION_BROWSE = "browse"
# 一次收齐整棵子树，勾上层节点用。⚠ 与 browse 分成两个动作：两者的设备负载
# 差着两个数量级，预算不是一档
ACTION_BROWSE_SUBTREE = "browse_subtree"
ACTION_READ = "read"
ACTION_WRITE = "write"
# ⚠ 一期 collector 还不认识它，会回 `unknown_action`。那与超时同档：结论是
# 「未校验」，绝不是「通过」（ADR-0011 的代价三）
ACTION_VALIDATE = "validate"

STATUS_OK = "ok"

# collector 的 `errors.py` 里那组稳定 `reason` 字面量
REASON_SOURCE_OFFLINE = "source_offline"
REASON_BROWSE_UNSUPPORTED = "browse_unsupported"
REASON_WRITE_UNSUPPORTED = "write_unsupported"
REASON_UNKNOWN_ACTION = "unknown_action"
# 本层自造的两条：应答里根本没有 status 字段 / 采集侧一句话都没回
REASON_MALFORMED = "malformed_reply"
REASON_NO_COLLECTOR = "collector_unreachable"

_MS_PER_S = 1000


@dataclass(frozen=True)
class BrowseEntry:
    """地址空间里的一项。"""

    address: str
    name: str
    has_children: bool
    is_variable: bool


@dataclass(frozen=True)
class SubtreeEntry:
    """子树里的一项，外加它挂在谁下面。

    ⚠ `parent` 不能省：调用方要靠它把平铺的结果拼回树。丢了层级，界面就只剩
    一张几千行的清单，用户无从判断这些点位分别属于哪台设备。
    """

    parent: str | None
    entry: BrowseEntry


@dataclass(frozen=True)
class SubtreeOutcome:
    """一次子树遍历的结论。

    ⚠ `is_truncated` 与条目同等重要：采集侧在预算内没走完却不说，界面就会把
    「只收到一半」显示成「这个通道就这么多点位」。
    """

    entries: tuple[SubtreeEntry, ...]
    is_truncated: bool


@dataclass(frozen=True)
class AddressVerdict:
    """一条寻址串在现场的结论。"""

    address: str
    is_valid: bool
    detail: str | None


@dataclass(frozen=True)
class CommandOutcome:
    """一次命令的原始结论。`data` 只在 `is_ok` 时有意义。"""

    is_ok: bool
    data: dict[str, Any]
    reason: str


@dataclass(frozen=True)
class CommandBus:
    """命令总线的业务面。每个方法都有显式预算，且都不重试。"""

    transport: CommandTransport
    browse_timeout_s: float
    command_timeout_s: float
    # 走一棵子树是几百趟设备往返，与浏览一层不能共用一档预算
    subtree_timeout_s: float

    async def browse(
        self, source_id: uuid.UUID, parent: str | None
    ) -> list[BrowseEntry]:
        """浏览一个数据源的地址空间。

        Args: source_id, parent（协议寻址串，None 表示根）。
        """
        outcome = await self._call(
            action=ACTION_BROWSE,
            source_id=source_id,
            timeout_s=self.browse_timeout_s,
            fields={"parent": parent},
        )
        if not outcome.is_ok:
            raise _browse_error(outcome.reason)
        return [_browse_entry(item) for item in _items(outcome.data, "items")]

    async def browse_subtree(
        self, source_id: uuid.UUID, parent: str | None
    ) -> SubtreeOutcome:
        """一次收齐一棵子树下的全部节点。

        ⚠ 递归在采集侧做。这一跳看着只是「多一个动作」，但它替掉的是前端逐层
        浏览时打出的**几百个串行请求**——每一个都要过一遍边缘、总线与设备。
        Args: source_id, parent（协议寻址串，None 表示根）。
        """
        outcome = await self._call(
            action=ACTION_BROWSE_SUBTREE,
            source_id=source_id,
            timeout_s=self.subtree_timeout_s,
            fields={"parent": parent},
        )
        if not outcome.is_ok:
            raise _browse_error(outcome.reason)
        return SubtreeOutcome(
            entries=tuple(
                _subtree_entry(item) for item in _items(outcome.data, "items")
            ),
            is_truncated=bool(outcome.data.get("is_truncated", False)),
        )

    async def probe(self, source_id: uuid.UUID) -> str | None:
        """连通性测试：能答上话就返回 None，否则给一句不可达的原因。

        ⚠ 不可达不抛异常：测试端点要能把「没有活会话」如实报出来，抛异常会让
        它与「总线坏了」在页面上长得一模一样。
        Args: source_id。
        """
        try:
            outcome = await self._call(
                action=ACTION_READ,
                source_id=source_id,
                timeout_s=self.command_timeout_s,
                fields={"point_codes": []},
            )
        except CollectorUnreachable:
            return REASON_NO_COLLECTOR
        return None if outcome.is_ok else outcome.reason

    async def verify_addresses(
        self, source_id: uuid.UUID, addresses: Sequence[str]
    ) -> tuple[AddressVerdict, ...] | None:
        """让现场校验一批寻址串。**没结论时返回 None，不当作通过**。

        ⚠ 采集侧联系不上也走「没结论」这条路，不抛：保存点位不该因为采集进程
        没起来就整个失败，但用户必须看见这条寻址串还没被现场确认过。
        Args: source_id, addresses。
        """
        if not addresses:
            return ()
        try:
            outcome = await self._call(
                action=ACTION_VALIDATE,
                source_id=source_id,
                timeout_s=self.command_timeout_s,
                fields={"addresses": list(addresses)},
            )
        except CollectorUnreachable:
            outcome = CommandOutcome(
                is_ok=False, data={}, reason=REASON_NO_COLLECTOR
            )
        if not outcome.is_ok:
            _logger.warning(
                "address_check_unverified",
                "寻址串未能在现场校验，按未校验回报",
                source_id=str(source_id),
                reason=outcome.reason,
            )
            return None
        return tuple(_verdict(item) for item in _items(outcome.data, "results"))

    async def write(
        self, source_id: uuid.UUID, point_code: str, value: object
    ) -> None:
        """向现场下发一个写值。

        ⚠ 超时按**不可重试**处理：超时不代表没写成功，盲目重试可能向 PLC 下发
        两次。幂等键是唯一的解（runtime-resilience §2）。
        Args: source_id, point_code, value。
        """
        outcome = await self._call(
            action=ACTION_WRITE,
            source_id=source_id,
            timeout_s=self.command_timeout_s,
            fields={"point_code": point_code, "value": value},
        )
        if not outcome.is_ok:
            raise _write_error(outcome.reason)

    async def _call(
        self,
        *,
        action: str,
        source_id: uuid.UUID,
        timeout_s: float,
        fields: dict[str, Any],
    ) -> CommandOutcome:
        """发一条命令并等应答。超时也是一种结论，不抛。

        Args: action, source_id, timeout_s, fields。
        """
        request_id = str(uuid7())
        envelope: dict[str, Any] = {
            "request_id": request_id,
            "action": action,
            "source_id": str(source_id),
            # ⚠ 绝对墙钟：超期的请求 leader 直接丢弃不应答，免得白占一次设备往返
            "deadline_ms": _deadline_ms(timeout_s),
            TRACEPARENT_KEY: current_traceparent(),
            **fields,
        }
        try:
            reply = await self.transport.call(
                envelope, request_id=request_id, timeout_s=timeout_s
            )
        except DependencyUnavailable as error:
            raise CollectorUnreachable(
                "采集侧暂时联系不上，请稍后重试"
            ) from error
        if reply is None:
            _logger.error(
                "command_timed_out",
                "命令没等到应答",
                action=action,
                source_id=str(source_id),
            )
            raise CollectorUnreachable("采集侧没有在预算内答复")
        return _outcome(reply)


def _deadline_ms(timeout_s: float) -> int:
    return int(utcnow().timestamp() * _MS_PER_S) + int(timeout_s * _MS_PER_S)


def _outcome(reply: dict[str, Any]) -> CommandOutcome:
    """把应答信封收敛成有类型的结论。

    Args: reply。
    """
    status = reply.get("status")
    if status == STATUS_OK:
        raw = reply.get("data")
        # JSON 的边界：isinstance 只能确认它是 dict，键值类型仍要在这里收敛
        data = cast("dict[str, Any]", raw) if isinstance(raw, dict) else {}
        return CommandOutcome(is_ok=True, data=data, reason="")
    reason = reply.get("reason")
    return CommandOutcome(
        is_ok=False,
        data={},
        reason=reason if isinstance(reason, str) else REASON_MALFORMED,
    )


def _items(data: dict[str, Any], key: str) -> list[dict[str, Any]]:
    """取应答里的一个对象数组；形状不符给空表。

    Args: data, key。
    """
    raw = data.get(key)
    if not isinstance(raw, list):
        return []
    entries = cast("list[object]", raw)
    return [
        cast("dict[str, Any]", item)
        for item in entries
        if isinstance(item, dict)
    ]


def _browse_entry(item: dict[str, Any]) -> BrowseEntry:
    return BrowseEntry(
        address=str(item.get("address", "")),
        name=str(item.get("name", "")),
        has_children=bool(item.get("has_children", False)),
        is_variable=bool(item.get("is_variable", False)),
    )


def _subtree_entry(item: dict[str, Any]) -> SubtreeEntry:
    """把一条子树结果收敛成有类型的项。

    ⚠ `parent` 缺省是 None（挂在根上），不是空串：空串会被当成一个真实存在
    的寻址串，拼树时那一枝就永远接不上。
    Args: item。
    """
    parent = item.get("parent")
    return SubtreeEntry(
        parent=parent if isinstance(parent, str) else None,
        entry=_browse_entry(item),
    )


def _verdict(item: dict[str, Any]) -> AddressVerdict:
    detail = item.get("detail")
    return AddressVerdict(
        address=str(item.get("address", "")),
        is_valid=bool(item.get("is_valid", False)),
        detail=str(detail) if isinstance(detail, str) else None,
    )


def _browse_error(reason: str) -> Exception:
    """把浏览的失败原因翻成本域的错误码。

    Args: reason。
    """
    if reason == REASON_BROWSE_UNSUPPORTED:
        return BrowseUnsupported("这个协议没有可浏览的地址空间")
    if reason == REASON_SOURCE_OFFLINE:
        return SourceOffline("采集侧还没连上这个数据源")
    if reason == REASON_UNKNOWN_ACTION:
        # ⚠ 只在两侧版本对不齐时出现（新平台 + 旧采集）。说清楚是版本问题，
        # 否则现场只看到一句「执行失败」，会照着设备与网络查一整天
        return CommandFailed("采集侧不认识这个动作，请先把采集进程升到同版本")
    return CommandFailed("采集侧执行浏览失败")


def _write_error(reason: str) -> Exception:
    """把写值的失败原因翻成本域的错误码。

    Args: reason。
    """
    if reason == REASON_WRITE_UNSUPPORTED:
        return WriteUnsupported("这个数据源不允许下发写值")
    if reason == REASON_SOURCE_OFFLINE:
        return SourceOffline("采集侧还没连上这个数据源")
    return CommandFailed("采集侧执行写值失败")
