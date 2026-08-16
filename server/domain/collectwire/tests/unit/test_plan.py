"""计划形状的解析：完整载荷、缺省值、边界与拒绝路径。"""

import pytest
from pydantic import ValidationError

from collectwire import (
    MIN_SAMPLING_INTERVAL_MS,
    READ_MODE_POLL,
    READ_MODE_SUBSCRIBE,
    READ_MODES,
    CollectPlan,
    PlanPoint,
    PlanSource,
)

SOURCE_ID = "0192f000-0000-7000-8000-000000000001"
FULL_PAYLOAD = {
    "version": "v7",
    "sources": [
        {
            "source_id": SOURCE_ID,
            "code": "line-1",
            "protocol": "opcua",
            "endpoint": "opc.tcp://10.0.0.9:4840/line-1",
            "read_mode": READ_MODE_SUBSCRIBE,
            "poll_interval_ms": 1000,
            "options": {"security_policy": "None"},
            "username": "operator",
            "password": "s3cret",
            "points": [
                {
                    "point_code": "outlet_temp",
                    "address": "ns=2;s=Temp1",
                    "sampling_interval_ms": 1000,
                    "archive_enabled": True,
                    "deadband": 0.5,
                    "archive_max_interval_ms": 60_000,
                }
            ],
        }
    ],
    "params": {"collect": {"snapshot_ttl_s": 30}},
}


def test_a_full_plan_payload_parses() -> None:
    plan = CollectPlan.model_validate(FULL_PAYLOAD)
    source = plan.sources[0]
    assert plan.version == "v7"
    assert source.points[0].address == "ns=2;s=Temp1"
    assert source.password == "s3cret"
    assert plan.params["collect"]["snapshot_ttl_s"] == 30


def test_read_modes_are_strings_not_numbers() -> None:
    assert READ_MODES == (READ_MODE_SUBSCRIBE, READ_MODE_POLL)


def test_an_empty_plan_is_a_valid_plan() -> None:
    """一个源都没有是合法状态——全停用时下发的就是它。"""
    plan = CollectPlan.model_validate({"version": "v0"})
    assert plan.sources == ()
    assert plan.source_ids() == frozenset()


def test_the_source_ids_come_back_as_a_set() -> None:
    plan = CollectPlan.model_validate(FULL_PAYLOAD)
    assert {str(one) for one in plan.source_ids()} == {SOURCE_ID}


def test_unknown_fields_are_ignored_rather_than_rejected() -> None:
    """下发方加一列不该让整个采集解析失败并停采。"""
    plan = CollectPlan.model_validate({**FULL_PAYLOAD, "future_knob": 1})
    assert plan.version == "v7"


def test_the_archive_trio_falls_back_to_documented_defaults() -> None:
    """⚠ 心跳缺省是 0（不发）——少发它，常年不变的曲线在库里只有一个点。"""
    point = PlanPoint.model_validate(
        {
            "point_code": "outlet_temp",
            "address": "ns=2;s=Temp1",
            "sampling_interval_ms": MIN_SAMPLING_INTERVAL_MS,
        }
    )
    assert (point.archive_enabled, point.deadband) == (True, 0.0)
    assert point.archive_max_interval_ms == 0


def test_a_source_without_credentials_parses() -> None:
    source = PlanSource.model_validate(
        {
            "source_id": SOURCE_ID,
            "code": "line-1",
            "protocol": "opcua",
            "endpoint": "opc.tcp://10.0.0.9:4840/line-1",
        }
    )
    assert (source.username, source.password) == (None, None)
    assert source.read_mode == READ_MODE_SUBSCRIBE


def test_sampling_below_the_floor_is_rejected() -> None:
    with pytest.raises(ValidationError):
        PlanPoint.model_validate(
            {
                "point_code": "outlet_temp",
                "address": "ns=2;s=Temp1",
                "sampling_interval_ms": MIN_SAMPLING_INTERVAL_MS - 1,
            }
        )


def test_a_negative_deadband_is_rejected() -> None:
    with pytest.raises(ValidationError):
        PlanPoint.model_validate(
            {
                "point_code": "outlet_temp",
                "address": "ns=2;s=Temp1",
                "sampling_interval_ms": 1000,
                "deadband": -1,
            }
        )


def test_blank_identities_are_rejected() -> None:
    """空编码与空寻址串取不到任何值，不许进计划。"""
    with pytest.raises(ValidationError):
        PlanPoint.model_validate(
            {"point_code": "", "address": "x", "sampling_interval_ms": 1000}
        )
    with pytest.raises(ValidationError):
        PlanPoint.model_validate(
            {"point_code": "x", "address": "", "sampling_interval_ms": 1000}
        )


def test_a_blank_version_is_rejected() -> None:
    """版本号是收敛的唯一依据，空串会让采集侧永远认为计划没变。"""
    with pytest.raises(ValidationError):
        CollectPlan.model_validate({"version": ""})


def test_the_plan_is_frozen() -> None:
    """计划在进程里被多个协程读，可变会让收敛读到半路改过的形状。"""
    plan = CollectPlan.model_validate(FULL_PAYLOAD)
    with pytest.raises(ValidationError):
        plan.version = "v8"


def test_credentials_never_show_up_in_a_repr() -> None:
    """⚠ 口令要经过异常渲染、日志与调试打印三条路，进了 repr 就等于进了日志。"""
    plan = CollectPlan.model_validate(FULL_PAYLOAD)
    assert "s3cret" not in repr(plan.sources[0])
    assert "s3cret" not in repr(plan)


def test_the_password_still_travels_in_a_dump() -> None:
    """⚠ 下发方拿 `model_dump` 算计划摘要——遮掉口令，改口令就算不出新版本。"""
    plan = CollectPlan.model_validate(FULL_PAYLOAD)
    assert plan.sources[0].model_dump(mode="json")["password"] == "s3cret"
