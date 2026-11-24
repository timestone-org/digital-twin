"""空压站需气量与四个推荐输出的部署绑定。"""

import uuid
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from timeseries import split_node_key


class MachinePoints(BaseModel):
    """从同一机组的归档测量拟合实际工况。"""

    model_config = ConfigDict(extra="forbid", frozen=True)

    volume: str
    power: str
    pressure: str
    speed: str | None = None
    volume_scale: float = Field(default=1.0, gt=0, allow_inf_nan=False)

    @property
    def keys(self) -> tuple[str, ...]:
        """按流量、功率、压力、转速顺序返回已配置点位。"""
        return (self.volume, self.power, self.pressure) + (
            (self.speed,) if self.speed else ()
        )


class CompressedAirConfig(BaseModel):
    """仅当完整配置时才启用推荐发布。"""

    model_config = ConfigDict(extra="forbid", frozen=True)

    demand_node_key: str
    opcua_instance_id: uuid.UUID
    recommendation_node_ids: tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]
    machines: tuple[
        MachinePoints | None,
        MachinePoints | None,
        MachinePoints | None,
        MachinePoints | None,
    ]
    available_node_keys: tuple[
        str | None, str | None, str | None, str | None
    ] = (None, None, None, None)
    calibration_days: int = Field(default=120, ge=3, le=366)
    minimum_samples_per_band: int = Field(default=60, ge=10, le=10000)
    calibration_pressure_min: float = Field(
        default=0.630, gt=0, allow_inf_nan=False
    )
    calibration_pressure_max: float = Field(
        default=0.660, gt=0, allow_inf_nan=False
    )

    @model_validator(mode="after")
    def validate_bindings(self) -> Self:
        """启动时拒绝非法测点身份和重复的输出。"""
        keys = self.input_keys
        for key in keys:
            split_node_key(key)
        if len(set(keys)) != len(keys):
            raise ValueError("需气量与可用状态点位不能重复")
        if len(set(self.recommendation_node_ids)) != len(
            self.recommendation_node_ids
        ):
            raise ValueError("四台空压机必须绑定四个不同的推荐节点")
        for index, machine in enumerate(self.machines):
            if machine is not None and (machine.speed is None) != (index == 0):
                raise ValueError("1# 为定频，已配置的 2# 至 4# 要有实际转速")
        calibration_keys = [
            key
            for machine in self.machines
            if machine is not None
            for key in machine.keys
        ]
        for key in calibration_keys:
            split_node_key(key)
        if len(set(calibration_keys)) != len(calibration_keys):
            raise ValueError("四台机组的标定点位不能重复")
        if self.calibration_pressure_min >= self.calibration_pressure_max:
            raise ValueError("标定压力下限必须小于上限")
        return self

    @property
    def input_keys(self) -> tuple[str, ...]:
        """需气量及实际已配置的可用状态点位。"""
        return (
            self.demand_node_key,
            *(key for key in self.available_node_keys if key is not None),
        )
