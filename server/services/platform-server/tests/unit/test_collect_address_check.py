"""寻址串校验的三档结论。

守的是「没校验成绝不当作通过」这条口径：超时、离线、动作不被支持都落
`unverified`，被现场明确拒掉的才 400。
"""

import uuid

import pytest

from platform_server.apps.collect.errors import PointInvalid
from platform_server.apps.collect.schemas import (
    CHECK_PASSED,
    CHECK_REJECTED,
    CHECK_UNVERIFIED,
    AddressCheckOut,
)
from platform_server.apps.collect.services.address_check import (
    UNVERIFIED_DETAIL,
    check_addresses,
    raise_if_rejected,
)
from platform_server.apps.collect.services.command_bus import CommandBus
from unit.collect_fakes import ACTION_VALIDATE, FakeCommandTransport

SOURCE_ID = uuid.UUID("0192f0c0-0000-7000-8000-0000000000b1")


def build_bus(transport: FakeCommandTransport) -> CommandBus:
    """按固定预算装一条总线。

    Args: transport。
    """
    return CommandBus(
        transport=transport,
        browse_timeout_s=10.0,
        command_timeout_s=5.0,
        subtree_timeout_s=15.0,
    )


async def test_no_reply_marks_every_address_unverified() -> None:
    checks = await check_addresses(
        build_bus(FakeCommandTransport()),
        source_id=SOURCE_ID,
        addresses=["ns=2;s=A", "ns=2;s=B"],
    )
    assert [item.status for item in checks] == [
        CHECK_UNVERIFIED,
        CHECK_UNVERIFIED,
    ]
    assert checks[0].detail == UNVERIFIED_DETAIL


async def test_a_valid_verdict_becomes_passed() -> None:
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
    checks = await check_addresses(
        build_bus(transport), source_id=SOURCE_ID, addresses=["ns=2;s=A"]
    )
    assert checks[0].status == CHECK_PASSED


async def test_an_invalid_verdict_becomes_rejected() -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_VALIDATE: {
                "status": "ok",
                "data": {
                    "results": [
                        {
                            "address": "ns=2;s=A",
                            "is_valid": False,
                            "detail": "BadNodeIdUnknown",
                        }
                    ]
                },
            }
        }
    )
    checks = await check_addresses(
        build_bus(transport), source_id=SOURCE_ID, addresses=["ns=2;s=A"]
    )
    assert checks[0].status == CHECK_REJECTED
    assert checks[0].detail == "BadNodeIdUnknown"


async def test_an_address_the_reply_never_mentions_stays_unverified() -> None:
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
    checks = await check_addresses(
        build_bus(transport),
        source_id=SOURCE_ID,
        addresses=["ns=2;s=A", "ns=2;s=B"],
    )
    assert checks[1].address == "ns=2;s=B"
    assert checks[1].status == CHECK_UNVERIFIED


async def test_a_repeated_address_is_asked_about_only_once() -> None:
    transport = FakeCommandTransport(
        replies={ACTION_VALIDATE: {"status": "ok", "data": {"results": []}}}
    )
    checks = await check_addresses(
        build_bus(transport),
        source_id=SOURCE_ID,
        addresses=["ns=2;s=A", "ns=2;s=A"],
    )
    assert len(checks) == 1
    assert transport.envelopes_of("validate")[0]["addresses"] == ["ns=2;s=A"]


def test_rejections_point_at_the_field_that_carried_them() -> None:
    checks = [
        AddressCheckOut(
            address="ns=2;s=A", status=CHECK_REJECTED, detail="现场不认识"
        )
    ]
    with pytest.raises(PointInvalid) as raised:
        raise_if_rejected(checks, field_of={"ns=2;s=A": "items[3].address"})
    assert raised.value.details[0].field == "items[3].address"
    assert raised.value.details[0].code == "address_rejected"
    assert raised.value.details[0].message == "现场不认识"


def test_a_rejection_without_a_mapped_field_falls_back_to_address() -> None:
    checks = [
        AddressCheckOut(address="ns=2;s=A", status=CHECK_REJECTED, detail=None)
    ]
    with pytest.raises(PointInvalid) as raised:
        raise_if_rejected(checks, field_of={})
    assert raised.value.details[0].field == "address"
    assert raised.value.details[0].message == "现场不认识这个寻址串"


def test_unverified_checks_do_not_block_the_save() -> None:
    checks = [
        AddressCheckOut(
            address="ns=2;s=A", status=CHECK_UNVERIFIED, detail=None
        )
    ]
    raise_if_rejected(checks, field_of={})
    assert checks[0].status == CHECK_UNVERIFIED
