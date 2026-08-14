"""采集计划的形状：platform 下发给 collector 的唯一输入（ADR-0001）。

⚠ 字段名与 collector-server 的 `apps/collect/schemas/plan.py` **逐字一致**。
服务之间不许互相 import，故这份是复述；改这里就要同步改那边，否则 collector
按 `extra="ignore"` 静默丢字段——现象是某个采样参数怎么改都不生效。
⚠ 计划**协议无关**：`address` 对平台不透明，只有对应驱动解析它（ADR-0011）。
"""

import uuid

from pydantic import Field

from platform_server.apps.collect.schemas.common import OutputModel


class PlanPointOut(OutputModel):
    """计划里的一个点位。

    ⚠ 归档三件套必须逐点下发：collector 侧的 `PlanPoint` 给了它们缺省值且
    忽略未知字段，所以这里少一个字段不会报错，只会让该点位按缺省跑——
    其中 `archive_max_interval_ms` 缺省是 0（不发心跳），后果是一条常年不变
    的曲线在库里永远只有一个点，读侧分不出「没变」与「没采到」。
    """

    point_code: str
    address: str
    sampling_interval_ms: int
    archive_enabled: bool
    deadband: float
    archive_max_interval_ms: int


class PlanSourceOut(OutputModel):
    """计划里的一个数据源。

    ⚠ 没有 `password` 字段：一期不下发凭据明文——`credential_enc` 的解密与
    轮换还没有落地，先下发一个假的比不下发更糟。collector 拿不到凭据时按
    匿名连接，连不上会响亮失败。
    """

    source_id: uuid.UUID
    code: str
    protocol: str
    endpoint: str
    read_mode: str
    poll_interval_ms: int
    options: dict[str, str]
    points: list[PlanPointOut]


class CollectPlanOut(OutputModel):
    """一次全量下发的计划。

    ⚠ `version` 是**内容摘要**不是时间戳：collector 只按它判断要不要重新收敛，
    而删掉一个点位并不会让任何一行的 `updated_at` 变新——用时间戳做版本，
    删除就永远推不下去。
    """

    version: str = Field(min_length=1)
    sources: list[PlanSourceOut]
