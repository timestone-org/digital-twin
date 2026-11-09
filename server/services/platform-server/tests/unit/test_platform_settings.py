"""启动期校验：写错的值在启动时拒掉，不留到运行期才炸。"""

import pytest
from pydantic import ValidationError

from platform_server.settings import Settings
from unit.wiring_fakes import build_settings


def _with(**overrides: object) -> Settings:
    """同一份能构造的配置，只换给定的几项。Args: overrides。"""
    fields = build_settings().model_dump()
    fields.update(overrides)
    return Settings(**fields)


def test_the_baseline_settings_construct() -> None:
    assert _with().app_role in {"api", "worker", "publisher"}


@pytest.mark.parametrize("role", ["api", "worker", "publisher"])
def test_every_known_role_is_accepted(role: str) -> None:
    assert _with(app_role=role).app_role == role


def test_a_mistyped_role_refuses_to_start() -> None:
    # ⚠ 放过去就是一个看着健康的 API 副本，实时推送与 worker 循环一个都没跑
    with pytest.raises(ValidationError):
        _with(app_role="publsher")


@pytest.mark.parametrize(
    "field",
    ["acsource_timezone", "collect_bucket_timezone", "dataset_bucket_timezone"],
)
def test_a_mistyped_timezone_refuses_to_start(field: str) -> None:
    with pytest.raises(ValidationError, match="时区"):
        _with(**{field: "Asia/Shangai"})


def test_a_publish_budget_as_long_as_the_tick_refuses_to_start() -> None:
    # ⚠ 预算不小于一拍，下一拍从一开始就迟到，迟到还会累积
    with pytest.raises(ValidationError, match="ACPUBLISH"):
        _with(acpublish_budget_s=60.0, acpublish_interval_s=60.0)


def test_a_model_timeout_beyond_the_budget_refuses_to_start() -> None:
    with pytest.raises(ValidationError, match="ACPUBLISH"):
        _with(acpublish_model_timeout_s=50.0, acpublish_budget_s=45.0)


@pytest.mark.parametrize(
    ("claim_idle", "prefetch", "timeout"),
    [
        (
            "acstartup_claim_idle_ms",
            "acstartup_prefetch",
            "acstartup_shard_timeout_s",
        ),
        (
            "acmodel_claim_idle_ms",
            "acmodel_prefetch",
            "acmodel_train_timeout_s",
        ),
        ("acdaily_claim_idle_ms", "acdaily_prefetch", "acdaily_timeout_s"),
    ],
)
def test_the_default_claim_threshold_outlasts_the_longest_hold(
    claim_idle: str, prefetch: str, timeout: str
) -> None:
    # ⚠ 一批取 n 条逐条处理，最后一条最多在 PEL 里滞留 n × 超时；门槛更短
    # 的话别的副本会把还在跑的消息认领走重做一遍
    fields = build_settings().model_dump()
    hold_ms = fields[prefetch] * fields[timeout] * 1000
    assert fields[claim_idle] > hold_ms
