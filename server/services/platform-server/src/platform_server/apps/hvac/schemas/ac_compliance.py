"""逐台季节配置与本次计算实际采用的达标范围。"""

from decimal import Decimal

from pydantic import Field, field_validator, model_validator

from platform_server.apps.hvac.rooms import (
    METRIC_WORKSHOP_HUMIDITY,
    METRIC_WORKSHOP_TEMP,
)
from platform_server.apps.hvac.schemas.ac_data import (
    MetricLimitIn,
    MetricLimitOut,
)
from platform_server.apps.hvac.schemas.common import (
    InputModel,
    OutputModel,
    Utc,
)
from platform_server.apps.hvac.seasons import Season, month_day

_MAX_LIMIT_MAGNITUDE = Decimal("1000000")


class WinterPeriodIn(InputModel):
    """每年重复的月日区间，起止日均包含。"""

    start: str = Field(pattern=r"^\d{2}-\d{2}$")
    end: str = Field(pattern=r"^\d{2}-\d{2}$")

    @field_validator("start", "end")
    @classmethod
    def valid_day(cls, value: str) -> str:
        month_day(value)
        return value


def validate_bands(items: list[MetricLimitIn], *, is_complete: bool) -> None:
    """校验指标、精度和两季完整性。Args: items, is_complete。"""
    required = {METRIC_WORKSHOP_TEMP, METRIC_WORKSHOP_HUMIDITY}
    seen: set[str] = set()
    for item in items:
        if item.metric not in required or item.metric in seen:
            raise ValueError("温湿度指标不合法或重复")
        seen.add(item.metric)
        lower, upper = item.lower_limit, item.upper_limit
        if is_complete and (lower is None or upper is None):
            raise ValueError("配置冬季时间后，两季温湿度上下限都必须填写")
        if lower is not None and upper is not None and lower > upper:
            raise ValueError("下限不能高于上限")
        for bound in (lower, upper):
            if bound is not None and (
                not bound.is_finite()
                or abs(bound) >= _MAX_LIMIT_MAGNITUDE
                or bound != bound.quantize(Decimal("0.01"))
            ):
                raise ValueError("达标范围最多六位整数、两位小数")
    if is_complete and seen != required:
        raise ValueError("配置冬季时间后，两季都必须包含温度和湿度")


class CompliancePolicyIn(InputModel):
    """覆盖一台空调的完整季节配置。"""

    winter_period: WinterPeriodIn | None = None
    non_winter: list[MetricLimitIn] = Field(max_length=2)
    winter: list[MetricLimitIn] = Field(
        default_factory=list[MetricLimitIn], max_length=2
    )

    @model_validator(mode="after")
    def complete_seasons(self) -> "CompliancePolicyIn":
        is_enabled = self.winter_period is not None
        validate_bands(self.non_winter, is_complete=is_enabled)
        validate_bands(self.winter, is_complete=is_enabled)
        if not is_enabled and self.winter:
            raise ValueError("未配置冬季时间时不应提交冬季范围")
        return self


class CompliancePolicyOut(OutputModel):
    """已保存的范围与服务端选定的当前季节。"""

    winter_period: WinterPeriodIn | None
    non_winter: list[MetricLimitOut]
    winter: list[MetricLimitOut]
    effective_season: Season
    effective_at: Utc
    timezone: str


class EffectiveComplianceOut(OutputModel):
    """某次计算中一台空调实际使用的范围。"""

    serial: str
    season: Season
    limits: list[MetricLimitOut]
