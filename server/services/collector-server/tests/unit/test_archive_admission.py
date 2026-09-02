"""守归档准入：首值 / 心跳到期 / 超死区 / 质量翻转，以及心跳补发的判定。

⚠ 准入的基线是上一条**已归档**的读数——拿见过的当基线，一条缓慢爬升的曲线
可以永远不触发死区而一行都不落库（COLLECT_DESIGN.md §4.3）。
"""

from typing import Any
from uuid import UUID

import pytest

from collector_server.apps.collect.archive.admission import (
    AdmissionGate,
    ArchivePolicy,
    is_beyond_deadband,
    policies_of,
)

SOURCE_ID = UUID("0192f000-0000-7000-8000-000000000001")
TS_MS = 1_767_323_045_000
KEY = (SOURCE_ID, "outlet_temp")
HEARTBEAT_MS = 2_000


def _gate() -> AdmissionGate:
    """一道时钟定在 `TS_MS` 的准入。"""
    return AdmissionGate(clock=lambda: TS_MS)


def test_the_first_reading_of_a_point_is_always_archived() -> None:
    gate = _gate()
    assert gate.admit(KEY, ArchivePolicy(), (21.5, TS_MS, "good")) is True


def test_an_unchanged_reading_is_not_archived_again() -> None:
    gate = _gate()
    gate.admit(KEY, ArchivePolicy(), (21.5, TS_MS, "good"))
    later = gate.admit(KEY, ArchivePolicy(), (21.5, TS_MS + 1000, "good"))
    assert later is False


def test_a_change_within_the_deadband_is_not_archived() -> None:
    gate = _gate()
    policy = ArchivePolicy(deadband=0.5)
    gate.admit(KEY, policy, (21.5, TS_MS, "good"))
    assert gate.admit(KEY, policy, (21.9, TS_MS + 1000, "good")) is False


def test_a_change_beyond_the_deadband_is_archived() -> None:
    gate = _gate()
    policy = ArchivePolicy(deadband=0.5)
    gate.admit(KEY, policy, (21.5, TS_MS, "good"))
    assert gate.admit(KEY, policy, (22.1, TS_MS + 1000, "good")) is True


def test_the_deadband_is_measured_against_the_last_archived_value() -> None:
    gate = _gate()
    policy = ArchivePolicy(deadband=2.0)
    gate.admit(KEY, policy, (20.0, TS_MS, "good"))
    # 三次爬升每次只走 0.4：拿「上一条见过的」当基线就永远越不过死区
    for step in range(1, 4):
        gate.admit(KEY, policy, (20.0 + 0.4 * step, TS_MS + step, "good"))
    assert gate.admit(KEY, policy, (22.1, TS_MS + 9, "good")) is True


def test_the_heartbeat_archives_a_value_that_never_changes() -> None:
    gate = _gate()
    policy = ArchivePolicy(max_interval_ms=60_000)
    gate.admit(KEY, policy, (21.5, TS_MS, "good"))
    assert gate.admit(KEY, policy, (21.5, TS_MS + 60_000, "good")) is True


def test_without_a_heartbeat_a_held_value_is_archived_once() -> None:
    gate = _gate()
    policy = ArchivePolicy(max_interval_ms=0)
    gate.admit(KEY, policy, (21.5, TS_MS, "good"))
    assert gate.admit(KEY, policy, (21.5, TS_MS + 86_400_000, "good")) is False


def test_a_quality_flip_is_archived_even_when_the_value_holds() -> None:
    gate = _gate()
    gate.admit(KEY, ArchivePolicy(), (21.5, TS_MS, "good"))
    assert gate.admit(KEY, ArchivePolicy(), (21.5, TS_MS + 1, "bad")) is True


def test_a_point_with_archiving_off_never_gets_in() -> None:
    gate = _gate()
    policy = ArchivePolicy(archive_enabled=False)
    assert gate.admit(KEY, policy, (21.5, TS_MS, "good")) is False


def test_dropping_a_point_from_the_plan_drops_its_baseline() -> None:
    gate = _gate()
    gate.admit(KEY, ArchivePolicy(), (21.5, TS_MS, "good"))
    gate.retain(frozenset())
    assert gate.size() == 0


def test_a_point_that_comes_back_starts_from_a_first_value_again() -> None:
    gate = _gate()
    gate.admit(KEY, ArchivePolicy(), (21.5, TS_MS, "good"))
    gate.retain(frozenset())
    assert gate.admit(KEY, ArchivePolicy(), (21.5, TS_MS + 1, "good")) is True


def test_a_baseline_still_in_the_plan_survives_a_refresh() -> None:
    gate = _gate()
    gate.admit(KEY, ArchivePolicy(), (21.5, TS_MS, "good"))
    gate.retain(frozenset({KEY}))
    assert gate.size() == 1


def test_the_gate_forgets_a_sighting_with_the_point() -> None:
    gate = _gate()
    policy = ArchivePolicy(max_interval_ms=HEARTBEAT_MS)
    gate.admit(KEY, policy, (21.5, TS_MS, "good"))
    gate.retain(frozenset())
    assert gate.heartbeat(KEY, policy, TS_MS + HEARTBEAT_MS) is None


def test_the_gate_does_not_heartbeat_before_the_interval_is_up() -> None:
    gate = _gate()
    policy = ArchivePolicy(max_interval_ms=HEARTBEAT_MS)
    gate.admit(KEY, policy, (21.5, TS_MS, "good"))
    assert gate.heartbeat(KEY, policy, TS_MS + HEARTBEAT_MS - 1) is None


def test_the_gate_heartbeats_on_the_grid_once_the_interval_is_up() -> None:
    gate = _gate()
    policy = ArchivePolicy(max_interval_ms=HEARTBEAT_MS)
    gate.admit(KEY, policy, (21.5, TS_MS, "good"))
    assert gate.heartbeat(KEY, policy, TS_MS + HEARTBEAT_MS + 300) == (
        21.5,
        TS_MS + HEARTBEAT_MS,
        "good",
    )


def test_a_forgotten_sighting_blocks_the_heartbeat_but_keeps_the_baseline() -> (
    None
):
    gate = _gate()
    policy = ArchivePolicy(max_interval_ms=HEARTBEAT_MS)
    gate.admit(KEY, policy, (21.5, TS_MS, "good"))
    gate.forget_seen(KEY)
    assert gate.heartbeat(KEY, policy, TS_MS + HEARTBEAT_MS) is None
    assert gate.size() == 1
    # 重连后推回来的同一个值不算首值，不多写一行
    assert gate.admit(KEY, policy, (21.5, TS_MS + 10, "good")) is False


@pytest.mark.parametrize(
    ("previous", "value", "is_expected"),
    [
        (True, False, True),
        (True, True, False),
        # 1.0 与 True 落库后是同一行（split_value 把 True 编成 1.0），
        # 所以这一步不该产生新历史
        (1.0, True, False),
        ("running", "stopped", True),
        ("running", "running", False),
        (None, 1.0, True),
    ],
    ids=[
        "bool-flip",
        "bool-hold",
        "bool-equals-number",
        "text-changed",
        "text-held",
        "none-to-number",
    ],
)
def test_non_numeric_values_compare_by_equality(
    previous: object, value: object, is_expected: bool
) -> None:
    assert is_beyond_deadband(previous, value, 10.0) is is_expected


def test_the_plan_becomes_a_flat_table_keyed_by_point(
    build_plan: Any, build_source: Any, build_point: Any
) -> None:
    plan = build_plan(
        sources=(
            build_source(
                points=(
                    build_point("outlet_temp", deadband=0.5),
                    build_point("inlet_temp", archive_enabled=False),
                )
            ),
        )
    )
    assert policies_of(plan)[(SOURCE_ID, "outlet_temp")] == ArchivePolicy(
        archive_enabled=True, deadband=0.5, max_interval_ms=0
    )
