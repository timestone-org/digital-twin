"""采集计划的版本号是**内容摘要**。

守的是「删掉一个点位也必须推得下去」——用 max(updated_at) 做版本，删除就永远
推不下去，而 collector 会继续采一个已经删掉的点位。
"""

import uuid

from platform_server.apps.collect.schemas import PlanPointOut, PlanSourceOut
from platform_server.apps.collect.services.plan_service import plan_version

SOURCE_ID = uuid.UUID("0192f0c0-0000-7000-8000-0000000000e1")


def build_source(*point_codes: str) -> PlanSourceOut:
    """一个带若干点位的计划数据源。

    Args: point_codes。
    """
    return PlanSourceOut(
        source_id=SOURCE_ID,
        code="line-1",
        protocol="opcua",
        endpoint="opc.tcp://10.0.0.9:4840",
        read_mode="subscribe",
        poll_interval_ms=1000,
        options={},
        points=[
            PlanPointOut(
                point_code=code,
                address=f"ns=2;s={code}",
                sampling_interval_ms=1000,
                archive_enabled=True,
                deadband=0.0,
                archive_max_interval_ms=60_000,
            )
            for code in point_codes
        ],
    )


def test_the_same_plan_hashes_to_the_same_version() -> None:
    first = plan_version([build_source("outlet_temp")])
    second = plan_version([build_source("outlet_temp")])
    assert first == second


def test_a_sha256_digest_is_64_hex_characters() -> None:
    assert len(plan_version([build_source("outlet_temp")])) == 64


def test_adding_a_point_changes_the_version() -> None:
    before = plan_version([build_source("outlet_temp")])
    after = plan_version([build_source("outlet_temp", "inlet_temp")])
    assert before != after


def test_removing_a_point_changes_the_version() -> None:
    before = plan_version([build_source("outlet_temp", "inlet_temp")])
    after = plan_version([build_source("outlet_temp")])
    assert before != after


def test_changing_an_address_changes_the_version() -> None:
    before = plan_version([build_source("outlet_temp")])
    changed = build_source("outlet_temp")
    changed.points[0].address = "ns=3;s=other"
    assert plan_version([changed]) != before


def test_an_empty_plan_still_has_a_version() -> None:
    assert len(plan_version([])) == 64
