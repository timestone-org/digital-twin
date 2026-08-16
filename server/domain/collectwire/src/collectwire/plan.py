"""采集计划的线形：platform 下发给 collector 的唯一输入（ADR-0001）。

⚠ 计划**协议无关**：`address` 对计划不透明，只有对应驱动解析它（ADR-0011）。
⚠ 形状只有这一份，两侧共用。以前两侧各写一份时，漏一个字段既不报错也不 422，
只会让该点位静默按缺省跑——最贵的是 `archive_max_interval_ms`，缺省 0 = 不发
心跳，于是一条常年不变的曲线在库里永远只有一个点。
"""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# 取值是字符串，禁数字枚举（api-contract §6）
READ_MODE_SUBSCRIBE = "subscribe"
READ_MODE_POLL = "poll"
READ_MODES = (READ_MODE_SUBSCRIBE, READ_MODE_POLL)

# 采样周期下限：比它更密的采样在工控网上只会堆包
MIN_SAMPLING_INTERVAL_MS = 50

# ⚠ 忽略未知字段：platform 加一列不该让整个 collector 解析失败并停采
_WIRE = ConfigDict(frozen=True, extra="ignore")


class PlanPoint(BaseModel):
    """计划里的一个点位。"""

    model_config = _WIRE

    point_code: str = Field(min_length=1)
    address: str = Field(min_length=1)
    sampling_interval_ms: int = Field(ge=MIN_SAMPLING_INTERVAL_MS)
    # 归档三件套：开关、死区、心跳。准入规则在采集侧的 archive/buffer.py
    archive_enabled: bool = True
    # 数值变化不超过它就不落库；0 = 只要值变了就落一条
    deadband: float = Field(default=0.0, ge=0)
    # ⚠ 心跳：距上一条归档超过它就必须再落一条，哪怕值一动没动。0 = 不发心跳
    archive_max_interval_ms: int = Field(default=0, ge=0)


class PlanSource(BaseModel):
    """计划里的一个数据源。"""

    model_config = _WIRE

    source_id: UUID
    code: str = Field(min_length=1)
    protocol: str = Field(min_length=1)
    endpoint: str = Field(min_length=1)
    # 订阅还是轮询。驱动不支持订阅时采集侧会自动降级
    read_mode: str = READ_MODE_SUBSCRIBE
    poll_interval_ms: int = Field(default=1000, ge=MIN_SAMPLING_INTERVAL_MS)
    options: dict[str, str] = Field(default_factory=dict[str, str])
    username: str | None = None
    # ⚠ `repr=False` 不是装饰：口令要经过异常渲染、日志与调试打印三条路，
    # 进了 repr 就等于进了日志。**不用 SecretStr**——下发方要拿它算计划的内容
    # 摘要，SecretStr 会把 `model_dump` 里的口令换成星号，于是改口令算不出新
    # 版本号，采集侧永远不会重新收敛
    password: str | None = Field(default=None, repr=False)
    points: tuple[PlanPoint, ...] = ()


class CollectPlan(BaseModel):
    """一次全量下发的计划。

    ⚠ 只按 `version` 判断要不要重新收敛，**不做增量**：增量消息丢一条就永久
    错位，而错位的采集会写出看似正常的错误历史（ADR-0001）。
    ⚠ `version` 是**内容摘要**不是时间戳：删掉一个点位不会让任何一行的
    `updated_at` 变新，用时间戳做版本，删除就永远推不下去。
    ⚠ `params` 是运行参数的**覆盖值**（稀疏，`{分组: {键: 值}}`）：没覆盖的键
    不下发，取值方回落到自己的环境变量默认值。
    """

    model_config = _WIRE

    version: str = Field(min_length=1)
    sources: tuple[PlanSource, ...] = ()
    params: dict[str, dict[str, bool | int | float]] = Field(
        default_factory=dict[str, dict[str, bool | int | float]]
    )

    def source_ids(self) -> frozenset[UUID]:
        """计划里的数据源 id 集合。"""
        return frozenset(source.source_id for source in self.sources)
