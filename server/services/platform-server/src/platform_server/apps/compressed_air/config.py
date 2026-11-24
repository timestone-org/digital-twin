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


class EstimatedFlowPoints(BaseModel):
    """同一台机组估算瞬时产气所需的两个实时点位。"""

    model_config = ConfigDict(extra="forbid", frozen=True)

    power: str
    site_qdb: str


class CompressedAirConfig(BaseModel):
    """仅当完整配置时才启用推荐发布。"""

    model_config = ConfigDict(extra="forbid", frozen=True)

    demand_node_key: str | None = None
    estimated_flow_points: (
        tuple[
            EstimatedFlowPoints,
            EstimatedFlowPoints,
            EstimatedFlowPoints,
            EstimatedFlowPoints,
        ]
        | None
    ) = None
    opcua_instance_id: uuid.UUID
    recommendation_node_ids: tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]
    recommendation_status_node_id: uuid.UUID | None = None
    calibration_table_id: uuid.UUID | None = None
    machines: tuple[
        MachinePoints | None,
        MachinePoints | None,
        MachinePoints | None,
        MachinePoints | None,
    ] = (None, None, None, None)
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
        if (self.demand_node_key is None) == (
            self.estimated_flow_points is None
        ):
            raise ValueError("须选择一种需气量输入：单点或四台机组估算产气")
        keys = self.input_keys
        if len({split_node_key(key) for key in keys}) != len(keys):
            raise ValueError("需气量输入与可用状态点位不能重复")
        outputs = self.output_node_ids
        if len(set(outputs)) != len(outputs):
            raise ValueError("推荐与状态输出节点不能重复")
        self._validate_calibration()
        return self

    def _validate_calibration(self) -> None:
        """校验台账或机组点位标定部署绑定。"""
        if self.calibration_table_id is not None and any(self.machines):
            raise ValueError("标定来源须选择一个台账或机组归档点位")
        calibration_keys = [
            key
            for machine in self.machines
            if machine is not None
            for key in machine.keys
        ]
        if len({split_node_key(key) for key in calibration_keys}) != len(
            calibration_keys
        ):
            raise ValueError("四台机组的标定点位不能重复")
        for index, machine in enumerate(self.machines):
            if machine is not None and (machine.speed is None) != (index == 0):
                raise ValueError("1# 为定频，已配置的 2# 至 4# 要有实际转速")
        if self.calibration_pressure_min >= self.calibration_pressure_max:
            raise ValueError("标定压力下限必须小于上限")

    @property
    def input_keys(self) -> tuple[str, ...]:
        """需气量及实际已配置的可用状态点位。"""
        demand_keys = (
            (self.demand_node_key,)
            if self.demand_node_key is not None
            else tuple(
                key
                for points in self.estimated_flow_points or ()
                for key in (points.power, points.site_qdb)
            )
        )
        return (
            *demand_keys,
            *(key for key in self.available_node_keys if key is not None),
        )

    @property
    def output_node_ids(self) -> tuple[uuid.UUID, ...]:
        """四台机组布尔节点及选配的状态节点。"""
        status = self.recommendation_status_node_id
        if status is None:
            return self.recommendation_node_ids
        return (*self.recommendation_node_ids, status)

    @property
    def candidate_machines(self) -> tuple[int, ...]:
        """历史台账标定覆盖四台，点位模式使用已配置机组。"""
        if self.calibration_table_id is not None:
            return (1, 2, 3, 4)
        return tuple(
            index
            for index, machine in enumerate(self.machines, 1)
            if machine is not None
        )
