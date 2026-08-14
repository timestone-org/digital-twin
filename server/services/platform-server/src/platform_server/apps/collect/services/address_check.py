"""保存点位时的寻址串校验 —— 走命令总线让 collector 用真驱动判。

⚠ 平台侧没有驱动，`address` 对它是不透明字符串（ADR-0011）。不校验的话，写错
的寻址串要到采集起来才失败，而那时页面上只是「这个点位没有数据」。
⚠ 校验不成（超时 / 采集侧离线 / 该动作还不被支持）一律标 `unverified`，
**绝不当作通过**——那正是这条口径要挡的静默降级。
"""

import uuid
from collections.abc import Sequence

from lib.errors.base import FieldError
from platform_server.apps.collect.errors import PointInvalid
from platform_server.apps.collect.schemas import (
    CHECK_PASSED,
    CHECK_REJECTED,
    CHECK_UNVERIFIED,
    AddressCheckOut,
)
from platform_server.apps.collect.services.command_bus import (
    AddressVerdict,
    CommandBus,
)

UNVERIFIED_DETAIL = "采集侧未答复，这条寻址串还没有被现场确认"


async def check_addresses(
    bus: CommandBus, *, source_id: uuid.UUID, addresses: Sequence[str]
) -> list[AddressCheckOut]:
    """让现场校验一批寻址串，逐条给结论。

    Args: bus, source_id, addresses。
    """
    unique = list(dict.fromkeys(addresses))
    verdicts = await bus.verify_addresses(source_id, unique)
    if verdicts is None:
        return [_unverified(address) for address in unique]
    answered = {item.address: item for item in verdicts}
    return [_checked(address, answered.get(address)) for address in unique]


def raise_if_rejected(
    checks: Sequence[AddressCheckOut], *, field_of: dict[str, str]
) -> None:
    """有被现场明确拒掉的寻址串就 400，并指到具体字段。

    Args: checks, field_of（寻址串 → 请求体里的字段路径）。
    """
    rejected = [item for item in checks if item.status == CHECK_REJECTED]
    if not rejected:
        return
    raise PointInvalid(
        "有寻址串在现场校验时被拒绝",
        details=tuple(
            FieldError(
                field=field_of.get(item.address, "address"),
                code="address_rejected",
                message=item.detail or "现场不认识这个寻址串",
            )
            for item in rejected
        ),
    )


def _unverified(address: str) -> AddressCheckOut:
    return AddressCheckOut(
        address=address, status=CHECK_UNVERIFIED, detail=UNVERIFIED_DETAIL
    )


def _checked(address: str, verdict: AddressVerdict | None) -> AddressCheckOut:
    """一条寻址串的结论；应答里没提到它就算没校过。

    Args: address, verdict。
    """
    if verdict is None:
        return _unverified(address)
    return AddressCheckOut(
        address=address,
        status=CHECK_PASSED if verdict.is_valid else CHECK_REJECTED,
        detail=verdict.detail,
    )
