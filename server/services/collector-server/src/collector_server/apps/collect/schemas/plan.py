"""采集计划的形状：platform 下发给 collector 的唯一输入（ADR-0001）。

⚠ 计划**协议无关**：`address` 对本层不透明，只有对应驱动解析它（ADR-0011）。
"""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr

from collector_server.apps.collect.drivers.base import (
    DriverConnection,
    DriverTimeouts,
    PointSpec,
)

# 取值是字符串，禁数字枚举（api-contract §6）
READ_MODE_SUBSCRIBE = "subscribe"
READ_MODE_POLL = "poll"
READ_MODES = (READ_MODE_SUBSCRIBE, READ_MODE_POLL)

# 采样周期下限：比它更密的采样在工控网上只会堆包
MIN_SAMPLING_INTERVAL_MS = 50


class PlanPoint(BaseModel):
    """计划里的一个点位。"""

    # ⚠ 忽略未知字段：platform 加一列不该让整个 collector 解析失败并停采
    model_config = ConfigDict(frozen=True, extra="ignore")

    point_code: str = Field(min_length=1)
    address: str = Field(min_length=1)
    sampling_interval_ms: int = Field(ge=MIN_SAMPLING_INTERVAL_MS)
    # 归档三件套：开关、死区、心跳。准入规则在 archive/buffer.py
    archive_enabled: bool = True
    # 数值变化不超过它就不落库；0 = 只要值变了就落一条
    deadband: float = Field(default=0.0, ge=0)
    # ⚠ 心跳：距上一条归档超过它就必须再落一条，哪怕值一动没动。0 = 不发
    # 心跳——那样一条常年不变的曲线在库里只有一个点，读侧无法区分「没变」
    # 与「没采到」
    archive_max_interval_ms: int = Field(default=0, ge=0)

    def to_spec(self) -> PointSpec:
        """翻成驱动认识的点位。"""
        return PointSpec(
            point_code=self.point_code,
            address=self.address,
            sampling_interval_ms=self.sampling_interval_ms,
        )


class PlanSource(BaseModel):
    """计划里的一个数据源。"""

    model_config = ConfigDict(frozen=True, extra="ignore")

    source_id: UUID
    code: str = Field(min_length=1)
    protocol: str = Field(min_length=1)
    endpoint: str = Field(min_length=1)
    # 订阅还是轮询。驱动不支持订阅时运行时会自动降级，见 runtime/poller.py
    read_mode: str = READ_MODE_SUBSCRIBE
    poll_interval_ms: int = Field(default=1000, ge=MIN_SAMPLING_INTERVAL_MS)
    options: dict[str, str] = Field(default_factory=dict[str, str])
    username: str | None = None
    # ⚠ SecretStr：口令要经过日志、指纹、异常三条路，裸 str 早晚会被打出去
    password: SecretStr | None = None
    points: tuple[PlanPoint, ...] = ()

    def to_connection(self, timeouts: DriverTimeouts) -> DriverConnection:
        """翻成驱动认识的连接参数。

        Args: timeouts。
        """
        secret = self.password
        return DriverConnection(
            endpoint=self.endpoint,
            options=dict(self.options),
            username=self.username,
            password=secret.get_secret_value() if secret else None,
            timeouts=timeouts,
        )

    def specs(self) -> tuple[PointSpec, ...]:
        """本数据源全部点位的驱动形态。"""
        return tuple(point.to_spec() for point in self.points)

    def without_points(self) -> "PlanSource":
        """去掉点位的副本。

        ⚠ 判「要不要重连」只看它：只加了一个点位就把整台设备的会话断一次，
        是每次保存配置都要停采几秒的做法。

        """
        return self.model_copy(update={"points": ()})


class CollectPlan(BaseModel):
    """一次全量下发的计划。

    ⚠ 只按 `version` 判断要不要重新收敛，**不做增量**：增量消息丢一条就
    永久错位，而错位的采集会写出看似正常的错误历史（ADR-0001）。
    ⚠ `params` 是运行参数的**覆盖值**（稀疏，`{分组: {键: 值}}`）：没覆盖的
    键不下发，取值方回落到本进程的环境变量默认值（见 `tuning.py`）。
    """

    model_config = ConfigDict(frozen=True, extra="ignore")

    version: str = Field(min_length=1)
    sources: tuple[PlanSource, ...] = ()
    params: dict[str, dict[str, bool | int | float]] = Field(
        default_factory=dict
    )

    def source_ids(self) -> frozenset[UUID]:
        """计划里的数据源 id 集合。"""
        return frozenset(source.source_id for source in self.sources)
