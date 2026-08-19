"""命令总线发起端的契约：信封形状、超时的处置、失败原因到错误码的翻译。

守的是「链路不许在异步处断掉」与「写超时按不可重试处理」两条。
"""

import uuid

import pytest

from platform_server.apps.collect.errors import (
    BrowseUnsupported,
    CollectorUnreachable,
    CommandFailed,
    SourceOffline,
    WriteUnsupported,
)
from platform_server.apps.collect.services.command_bus import CommandBus
from unit.collect_fakes import (
    ACTION_BROWSE,
    ACTION_BROWSE_SUBTREE,
    ACTION_READ,
    ACTION_VALIDATE,
    ACTION_WRITE,
    FakeCommandTransport,
    unreachable_transport,
)

SOURCE_ID = uuid.UUID("0192f0c0-0000-7000-8000-0000000000a1")
BROWSE_TIMEOUT_S = 10.0
COMMAND_TIMEOUT_S = 5.0
SUBTREE_TIMEOUT_S = 15.0


def build_bus(transport: FakeCommandTransport) -> CommandBus:
    """按固定预算装一条总线。

    Args: transport。
    """
    return CommandBus(
        transport=transport,
        browse_timeout_s=BROWSE_TIMEOUT_S,
        command_timeout_s=COMMAND_TIMEOUT_S,
        subtree_timeout_s=SUBTREE_TIMEOUT_S,
    )


async def test_every_envelope_carries_a_traceparent() -> None:
    transport = FakeCommandTransport(
        replies={ACTION_BROWSE: {"status": "ok", "data": {"items": []}}}
    )
    await build_bus(transport).browse(SOURCE_ID, None)
    envelope = transport.envelopes_of(ACTION_BROWSE)[0]
    traceparent = envelope["traceparent"]
    assert isinstance(traceparent, str)
    assert traceparent.startswith("00-")
    assert traceparent.endswith("-01")
    assert len(traceparent.split("-")) == 4


async def test_the_envelope_names_the_action_and_the_source() -> None:
    transport = FakeCommandTransport(
        replies={ACTION_WRITE: {"status": "ok", "data": {}}}
    )
    await build_bus(transport).write(SOURCE_ID, "outlet_temp", 21.5)
    envelope = transport.envelopes_of(ACTION_WRITE)[0]
    assert envelope["action"] == "write"
    assert envelope["source_id"] == str(SOURCE_ID)
    assert envelope["point_code"] == "outlet_temp"
    assert envelope["value"] == 21.5


async def test_the_envelope_carries_an_absolute_deadline() -> None:
    transport = FakeCommandTransport(
        replies={ACTION_BROWSE: {"status": "ok", "data": {"items": []}}}
    )
    await build_bus(transport).browse(SOURCE_ID, "ns=2;s=Root")
    envelope = transport.envelopes_of(ACTION_BROWSE)[0]
    deadline_ms = envelope["deadline_ms"]
    assert isinstance(deadline_ms, int)
    # 绝对墙钟毫秒，远大于 2026 年的秒级时间戳
    assert deadline_ms > 1_700_000_000_000


async def test_a_missing_reply_is_reported_as_unreachable() -> None:
    bus = build_bus(FakeCommandTransport())
    with pytest.raises(CollectorUnreachable):
        await bus.browse(SOURCE_ID, None)


async def test_an_unreachable_bus_is_not_marked_retryable() -> None:
    bus = build_bus(unreachable_transport())
    with pytest.raises(CollectorUnreachable) as raised:
        await bus.write(SOURCE_ID, "outlet_temp", 1)
    assert raised.value.is_retryable is False


async def test_browse_translates_unsupported_into_its_own_code() -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE: {"status": "error", "reason": "browse_unsupported"}
        }
    )
    with pytest.raises(BrowseUnsupported) as raised:
        await build_bus(transport).browse(SOURCE_ID, None)
    assert raised.value.code == 41112


async def test_browse_translates_offline_into_a_conflict() -> None:
    transport = FakeCommandTransport(
        replies={ACTION_BROWSE: {"status": "error", "reason": "source_offline"}}
    )
    with pytest.raises(SourceOffline) as raised:
        await build_bus(transport).browse(SOURCE_ID, None)
    assert raised.value.http_status == 409


async def test_an_unknown_browse_failure_falls_back_to_command_failed() -> None:
    transport = FakeCommandTransport(
        replies={ACTION_BROWSE: {"status": "error", "reason": "driver_failed"}}
    )
    with pytest.raises(CommandFailed):
        await build_bus(transport).browse(SOURCE_ID, None)


async def test_write_translates_unsupported_into_its_own_code() -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_WRITE: {"status": "error", "reason": "write_unsupported"}
        }
    )
    with pytest.raises(WriteUnsupported) as raised:
        await build_bus(transport).write(SOURCE_ID, "setpoint", 1)
    assert raised.value.code == 41113


async def test_browse_maps_every_field_of_an_entry() -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE: {
                "status": "ok",
                "data": {
                    "items": [
                        {
                            "address": "ns=2;s=Temp1",
                            "name": "出口温度",
                            "has_children": False,
                            "is_variable": True,
                        }
                    ]
                },
            }
        }
    )
    entries = await build_bus(transport).browse(SOURCE_ID, None)
    assert len(entries) == 1
    assert entries[0].address == "ns=2;s=Temp1"
    assert entries[0].name == "出口温度"
    assert entries[0].has_children is False
    assert entries[0].is_variable is True


@pytest.mark.parametrize(
    ("wire", "expected"),
    [
        ("string", "string"),
        ("bool", "bool"),
        (None, None),
        ("decimal", None),
        (11, None),
    ],
    ids=["string", "bool", "null", "unknown-word", "not-a-word"],
)
async def test_the_value_type_comes_through_and_unknowns_become_none(
    wire: object, expected: str | None
) -> None:
    """⚠ 采集侧翻出本侧不认识的字面量时不许 500：那会让整棵树浏览不出来。"""
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE: {
                "status": "ok",
                "data": {
                    "items": [
                        {
                            "address": "ns=2;s=Note",
                            "name": "Note",
                            "has_children": False,
                            "is_variable": True,
                            "data_type": wire,
                        }
                    ]
                },
            }
        }
    )
    entries = await build_bus(transport).browse(SOURCE_ID, None)
    assert entries[0].data_type == expected


async def test_an_item_without_a_value_type_reads_as_unknown() -> None:
    """老采集器不带这一项，那是「没读到」而不是解析失败。"""
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE: {
                "status": "ok",
                "data": {"items": [{"address": "ns=2;s=A"}]},
            }
        }
    )
    entries = await build_bus(transport).browse(SOURCE_ID, None)
    assert entries[0].data_type is None


async def test_a_malformed_browse_item_is_dropped() -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE: {
                "status": "ok",
                "data": {"items": ["不是对象", {"address": "ns=2;s=A"}]},
            }
        }
    )
    entries = await build_bus(transport).browse(SOURCE_ID, None)
    assert len(entries) == 1
    assert entries[0].address == "ns=2;s=A"


async def test_browse_gives_an_empty_list_when_data_has_no_items() -> None:
    transport = FakeCommandTransport(
        replies={ACTION_BROWSE: {"status": "ok", "data": {}}}
    )
    assert await build_bus(transport).browse(SOURCE_ID, None) == []


async def test_probe_returns_none_when_the_source_answers() -> None:
    transport = FakeCommandTransport(
        replies={ACTION_READ: {"status": "ok", "data": {"samples": []}}}
    )
    assert await build_bus(transport).probe(SOURCE_ID) is None


async def test_probe_returns_the_reason_when_the_source_is_offline() -> None:
    transport = FakeCommandTransport(
        replies={ACTION_READ: {"status": "error", "reason": "source_offline"}}
    )
    assert await build_bus(transport).probe(SOURCE_ID) == "source_offline"


async def test_a_reply_without_a_status_is_not_treated_as_success() -> None:
    transport = FakeCommandTransport(replies={ACTION_READ: {"data": {}}})
    assert await build_bus(transport).probe(SOURCE_ID) == "malformed_reply"


async def test_verifying_no_addresses_skips_the_round_trip() -> None:
    transport = FakeCommandTransport()
    assert await build_bus(transport).verify_addresses(SOURCE_ID, []) == ()
    assert transport.sent == []


async def test_an_unknown_action_yields_no_verdict_rather_than_a_pass() -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_VALIDATE: {"status": "error", "reason": "unknown_action"}
        }
    )
    verdicts = await build_bus(transport).verify_addresses(
        SOURCE_ID, ["ns=2;s=Temp1"]
    )
    assert verdicts is None


async def test_verdicts_carry_the_validity_and_the_detail() -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_VALIDATE: {
                "status": "ok",
                "data": {
                    "results": [
                        {
                            "address": "ns=2;s=Temp1",
                            "is_valid": False,
                            "detail": "BadNodeIdUnknown",
                        }
                    ]
                },
            }
        }
    )
    verdicts = await build_bus(transport).verify_addresses(
        SOURCE_ID, ["ns=2;s=Temp1"]
    )
    assert verdicts is not None
    assert verdicts[0].address == "ns=2;s=Temp1"
    assert verdicts[0].is_valid is False
    assert verdicts[0].detail == "BadNodeIdUnknown"


async def test_a_verdict_without_a_detail_keeps_it_null() -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_VALIDATE: {
                "status": "ok",
                "data": {
                    "results": [{"address": "ns=2;s=A", "is_valid": True}]
                },
            }
        }
    )
    verdicts = await build_bus(transport).verify_addresses(
        SOURCE_ID, ["ns=2;s=A"]
    )
    assert verdicts is not None
    assert verdicts[0].detail is None


async def test_write_translates_offline_into_a_conflict() -> None:
    transport = FakeCommandTransport(
        replies={ACTION_WRITE: {"status": "error", "reason": "source_offline"}}
    )
    with pytest.raises(SourceOffline) as raised:
        await build_bus(transport).write(SOURCE_ID, "setpoint", 1)
    assert raised.value.http_status == 409


async def test_an_unknown_write_failure_falls_back_to_command_failed() -> None:
    transport = FakeCommandTransport(
        replies={ACTION_WRITE: {"status": "error", "reason": "driver_failed"}}
    )
    with pytest.raises(CommandFailed):
        await build_bus(transport).write(SOURCE_ID, "setpoint", 1)


async def test_browsing_gets_the_wider_budget() -> None:
    # ⚠ 浏览要往返一趟现场设备，与别的命令不共用一档超时
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE: {"status": "ok", "data": {"items": []}},
            ACTION_WRITE: {"status": "ok", "data": {}},
        }
    )
    bus = build_bus(transport)
    await bus.browse(SOURCE_ID, None)
    await bus.write(SOURCE_ID, "setpoint", 1)
    assert transport.budgets == [BROWSE_TIMEOUT_S, COMMAND_TIMEOUT_S]


async def test_walking_a_subtree_gets_a_budget_of_its_own() -> None:
    # ⚠ 走一棵子树是几百趟设备往返，按浏览一层的预算去等一定等不到
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE_SUBTREE: {
                "status": "ok",
                "data": {"items": [], "is_truncated": False},
            }
        }
    )
    await build_bus(transport).browse_subtree(SOURCE_ID, "ns=2;s=Ch")
    assert transport.budgets == [SUBTREE_TIMEOUT_S]


async def test_a_subtree_entry_remembers_who_it_hangs_under() -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE_SUBTREE: {
                "status": "ok",
                "data": {
                    "items": [
                        {
                            "parent": "ns=2;s=Ch",
                            "address": "ns=2;s=Ch.Temp",
                            "name": "出口温度",
                            "has_children": False,
                            "is_variable": True,
                        }
                    ],
                    "is_truncated": True,
                },
            }
        }
    )
    outcome = await build_bus(transport).browse_subtree(SOURCE_ID, "ns=2;s=Ch")
    assert outcome.entries[0].parent == "ns=2;s=Ch"
    assert outcome.entries[0].entry.address == "ns=2;s=Ch.Temp"
    assert outcome.is_truncated is True


async def test_a_subtree_item_without_a_parent_hangs_on_the_root() -> None:
    # ⚠ 缺 parent 要落到 None（挂在根上），落成空串就成了一个不存在的寻址串
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE_SUBTREE: {
                "status": "ok",
                "data": {
                    "items": [
                        {
                            "address": "ns=2;s=Ch",
                            "name": "通道",
                            "has_children": True,
                            "is_variable": False,
                        }
                    ]
                },
            }
        }
    )
    outcome = await build_bus(transport).browse_subtree(SOURCE_ID, None)
    assert outcome.entries[0].parent is None
    assert outcome.is_truncated is False


async def test_an_old_collector_reads_as_a_version_gap_not_a_device_fault() -> (
    None
):
    # ⚠ 新平台 + 旧采集：不说清是版本对不齐，现场会照着设备与网络查一整天
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE_SUBTREE: {
                "status": "error",
                "reason": "unknown_action",
            }
        }
    )
    with pytest.raises(CommandFailed) as raised:
        await build_bus(transport).browse_subtree(SOURCE_ID, "ns=2;s=Ch")
    assert "升到同版本" in str(raised.value)


async def test_a_subtree_on_an_offline_source_reads_the_same_as_browse() -> (
    None
):
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE_SUBTREE: {
                "status": "error",
                "reason": "source_offline",
            }
        }
    )
    with pytest.raises(SourceOffline):
        await build_bus(transport).browse_subtree(SOURCE_ID, "ns=2;s=Ch")
