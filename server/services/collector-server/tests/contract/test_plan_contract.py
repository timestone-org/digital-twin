"""守采集计划的形状：platform 下发什么、collector 认得什么。

⚠ 计划是协议无关的：`address` 对本层不透明，只有驱动解析（ADR-0011）。
⚠ 未知字段一律忽略——platform 加一列不该让整个采集停摆。
"""

import pytest
from pydantic import ValidationError

from collector_server.apps.collect.drivers.base import DriverTimeouts
from collector_server.apps.collect.schemas.plan import (
    READ_MODE_POLL,
    READ_MODE_SUBSCRIBE,
    READ_MODES,
    CollectPlan,
)

PAYLOAD = {
    "version": "v7",
    "sources": [
        {
            "source_id": "0192f000-0000-7000-8000-000000000001",
            "code": "line-1",
            "protocol": "opcua",
            "endpoint": "opc.tcp://10.0.0.9:4840/line-1",
            "read_mode": "subscribe",
            "poll_interval_ms": 1000,
            "options": {"security_policy": "None"},
            "username": "operator",
            "password": "s3cret",
            "points": [
                {
                    "point_code": "outlet_temp",
                    "address": "ns=2;s=Temp1",
                    "sampling_interval_ms": 1000,
                }
            ],
        }
    ],
}


def test_a_full_plan_payload_parses() -> None:
    plan = CollectPlan.model_validate(PAYLOAD)
    assert plan.version == "v7"
    assert plan.sources[0].points[0].address == "ns=2;s=Temp1"


def test_read_modes_are_strings_not_numbers() -> None:
    assert READ_MODES == ("subscribe", "poll")
    assert (READ_MODE_SUBSCRIBE, READ_MODE_POLL) == ("subscribe", "poll")


def test_credentials_never_show_up_in_a_repr() -> None:
    plan = CollectPlan.model_validate(PAYLOAD)
    assert "s3cret" not in repr(plan.sources[0])


def test_a_source_translates_into_driver_inputs() -> None:
    source = CollectPlan.model_validate(PAYLOAD).sources[0]
    connection = source.to_connection(DriverTimeouts())
    assert connection.endpoint == "opc.tcp://10.0.0.9:4840/line-1"
    assert connection.password == "s3cret"
    assert connection.options == {"security_policy": "None"}


def test_fields_platform_adds_later_are_ignored() -> None:
    payload = {
        "version": "v8",
        "invented_later": True,
        "sources": [
            {**PAYLOAD["sources"][0], "archive_enabled": True},  # type: ignore[index]  # 契约样本是字面量
        ],
    }
    assert CollectPlan.model_validate(payload).version == "v8"


def test_the_three_archive_parameters_travel_with_each_point() -> None:
    payload = {
        "version": "v10",
        "sources": [
            {
                **PAYLOAD["sources"][0],  # type: ignore[dict-item]  # 契约样本是字面量
                "points": [
                    {
                        "point_code": "outlet_temp",
                        "address": "ns=2;s=Temp1",
                        "sampling_interval_ms": 1000,
                        "archive_enabled": False,
                        "deadband": 0.5,
                        "archive_max_interval_ms": 60000,
                    }
                ],
            }
        ],
    }
    point = CollectPlan.model_validate(payload).sources[0].points[0]
    assert (
        point.archive_enabled,
        point.deadband,
        point.archive_max_interval_ms,
    ) == (False, 0.5, 60000)


def test_a_point_without_archive_parameters_still_gets_archived() -> None:
    point = CollectPlan.model_validate(PAYLOAD).sources[0].points[0]
    # ⚠ 缺字段时的降级方向是「照常归档」：计划里没说，宁可多写几行也不要在
    # 库里留一段没人察觉的空白
    assert (
        point.archive_enabled,
        point.deadband,
        point.archive_max_interval_ms,
    ) == (True, 0.0, 0)


def test_a_negative_deadband_is_refused() -> None:
    payload = {
        "version": "v11",
        "sources": [
            {
                **PAYLOAD["sources"][0],  # type: ignore[dict-item]  # 契约样本是字面量
                "points": [
                    {
                        "point_code": "outlet_temp",
                        "address": "ns=2;s=Temp1",
                        "sampling_interval_ms": 1000,
                        "deadband": -1.0,
                    }
                ],
            }
        ],
    }
    with pytest.raises(ValidationError):
        CollectPlan.model_validate(payload)


def test_a_plan_without_a_version_is_refused() -> None:
    with pytest.raises(ValidationError):
        CollectPlan.model_validate({"sources": []})


def test_a_sampling_interval_below_the_floor_is_refused() -> None:
    payload = {
        "version": "v9",
        "sources": [
            {
                **PAYLOAD["sources"][0],  # type: ignore[dict-item]  # 契约样本是字面量
                "points": [
                    {
                        "point_code": "too_fast",
                        "address": "ns=2;s=X",
                        "sampling_interval_ms": 1,
                    }
                ],
            }
        ],
    }
    with pytest.raises(ValidationError):
        CollectPlan.model_validate(payload)


def test_changing_only_points_leaves_the_connection_identity_equal() -> None:
    plan = CollectPlan.model_validate(PAYLOAD)
    grown = plan.sources[0].model_copy(update={"points": ()})
    assert grown.without_points() == plan.sources[0].without_points()
