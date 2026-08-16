"""采集运行态的只读面：collector 写、平台读。

⚠ 读不到不许把配置页打挂：collector 没起来时配置本身照样要能看、能改，界面
按「还不知道」显示，而不是弹一个 503。
"""

import uuid
from datetime import UTC, datetime

from collectwire import STATE_UNKNOWN
from platform_server.apps.collect.errors import HistoryUnavailable
from platform_server.apps.collect.services.state_source import (
    UNKNOWN,
    SourceStateSource,
    decode_rows,
)
from unit.collect_fakes import FakeHistorySource

SOURCE_A = uuid.UUID("0199a000-0000-7000-8000-00000000000a")
UPDATED_AT = datetime(2026, 8, 16, 2, 0, tzinfo=UTC)


def state_row(**overrides: object) -> dict[str, object]:
    """一行运行态，列名与只读查询选出的一致。

    Args: overrides。
    """
    row: dict[str, object] = {
        "source_id": SOURCE_A,
        "state": "online",
        "point_count": 12,
        "error_category": None,
        "error_detail": None,
        "leader_instance": "collector-1",
        "updated_at": UPDATED_AT,
    }
    row.update(overrides)
    return row


async def test_an_empty_ask_never_touches_the_database() -> None:
    history = FakeHistorySource()
    assert await SourceStateSource(history=history).read([]) == {}


async def test_a_running_source_reads_back_as_online() -> None:
    history = FakeHistorySource(rows=[state_row()])
    found = await SourceStateSource(history=history).read([SOURCE_A])
    assert found[SOURCE_A].state == "online"
    assert found[SOURCE_A].point_count == 12


async def test_a_source_the_collector_never_saw_is_simply_absent() -> None:
    # 缺失与 offline 是两件事：前者去看 collector 活没活，后者去看现场
    history = FakeHistorySource(rows=[])
    assert await SourceStateSource(history=history).read([SOURCE_A]) == {}


async def test_an_unreadable_state_degrades_instead_of_failing() -> None:
    history = FakeHistorySource(failure=HistoryUnavailable("库读不了"))
    assert await SourceStateSource(history=history).read([SOURCE_A]) == {}


def test_the_unknown_placeholder_says_it_does_not_know() -> None:
    assert UNKNOWN.state == STATE_UNKNOWN


def test_a_state_outside_the_closed_set_shows_as_unknown() -> None:
    # 只有绕过 CHECK 直接改库才会走到这里；原样透出会让界面按未知分支渲染
    found = decode_rows([state_row(state="燃烧中")])
    assert found[SOURCE_A].state == STATE_UNKNOWN


def test_a_row_without_a_usable_id_is_dropped() -> None:
    assert decode_rows([state_row(source_id="不是 UUID")]) == {}


def test_an_error_is_carried_through_with_its_category() -> None:
    found = decode_rows(
        [state_row(state="offline", error_category="auth", error_detail="BadX")]
    )
    assert (found[SOURCE_A].error_category, found[SOURCE_A].error_detail) == (
        "auth",
        "BadX",
    )
