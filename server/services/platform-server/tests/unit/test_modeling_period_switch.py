"""部署换版将数据周期作为输入契约，并兼容未知周期的历史签名。"""

import uuid

import pytest
from pydantic import JsonValue

from platform_server.apps.modeling.management_errors import (
    DeploymentSignatureChanged,
)
from platform_server.apps.modeling.models import ModelingModelVersion
from platform_server.apps.modeling.schemas.management import DeploymentSwitchIn
from platform_server.apps.modeling.services.deployment_switch import (
    _check_switch,
)


def _fixed(interval_ms: int) -> dict[str, JsonValue]:
    return {
        "kind": "fixed",
        "interval_ms": interval_ms,
        "calendar_unit": None,
        "timezone": None,
    }


def _calendar(timezone: str) -> dict[str, JsonValue]:
    return {
        "kind": "calendar",
        "interval_ms": None,
        "calendar_unit": "month",
        "timezone": timezone,
    }


def _version(
    identity: int, period: JsonValue, *, is_legacy: bool
) -> ModelingModelVersion:
    signature: dict[str, JsonValue] = {"data_period": period}
    if not is_legacy:
        signature.update(
            {
                "format_version": "1.0",
                "requires_timestamp": False,
                "inputs": [{"key": "temperature", "dtype": "number"}],
                "output": {"key": "energy", "task": "regression"},
            }
        )
    return ModelingModelVersion(
        id=uuid.UUID(int=identity),
        pipeline_id=uuid.UUID(int=10),
        task="regression",
        servable=True,
        feature_keys=["temperature"],
        target_key="energy",
        signature_json=signature,
    )


@pytest.mark.parametrize("is_legacy", [False, True], ids=["full", "legacy"])
@pytest.mark.parametrize(
    ("before", "after"),
    [
        (_fixed(900000), _fixed(3600000)),
        (None, _fixed(1800000)),
        (_calendar("Asia/Shanghai"), _calendar("UTC")),
    ],
    ids=["fixed-interval", "unknown-to-known", "calendar-timezone"],
)
def test_changed_data_period_requires_explicit_confirmation(
    before: JsonValue, after: JsonValue, is_legacy: bool
) -> None:
    source = _version(1, before, is_legacy=is_legacy)
    target = _version(2, after, is_legacy=is_legacy)
    payload = DeploymentSwitchIn(
        expected_revision=1, model_version_id=target.id
    )
    with pytest.raises(DeploymentSignatureChanged):
        _check_switch(source, target, payload)


@pytest.mark.parametrize("is_legacy", [False, True], ids=["full", "legacy"])
def test_missing_and_null_data_period_are_compatible(is_legacy: bool) -> None:
    source = _version(1, None, is_legacy=is_legacy)
    source.signature_json.pop("data_period")
    target = _version(2, None, is_legacy=is_legacy)
    payload = DeploymentSwitchIn(
        expected_revision=1, model_version_id=target.id
    )
    assert _check_switch(source, target, payload) is None


def test_a_confirmed_data_period_change_is_allowed() -> None:
    source = _version(1, _fixed(900000), is_legacy=False)
    target = _version(2, _fixed(3600000), is_legacy=False)
    payload = DeploymentSwitchIn(
        expected_revision=1,
        model_version_id=target.id,
        is_signature_change_confirmed=True,
    )
    assert _check_switch(source, target, payload) is None
