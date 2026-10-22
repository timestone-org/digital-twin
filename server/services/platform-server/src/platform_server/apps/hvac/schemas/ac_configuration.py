"""抽取与训练配置快照的持久化边界。"""

from pydantic import Field

from platform_server.apps.hvac.schemas.ac_compliance import WinterPeriodIn
from platform_server.apps.hvac.schemas.ac_data import MetricLimitIn
from platform_server.apps.hvac.schemas.common import InputModel


class StoredWinterPolicy(InputModel):
    """冬季日期与温湿度范围，非冬季范围仍由原表持有。"""

    period: WinterPeriodIn
    limits: list[MetricLimitIn] = Field(max_length=2)


class BoundUnitSnapshot(InputModel):
    """一台绑定机组的完整计算配置。"""

    serial: str
    source_object: str
    non_winter: list[MetricLimitIn]
    winter: StoredWinterPolicy | None = None


class RoomConfigurationSnapshot(InputModel):
    """房间的一份可重现配置，不随时间或季节切换而改变。"""

    units: list[BoundUnitSnapshot]
    members: list[str]
    timezone: str
    rules: dict[str, int | bool]
    rules_fingerprint: str
