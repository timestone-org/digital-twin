"""模型版本表：一次成功运行发布出来的、不可变的可服务件（§4.4）。

⚠ 发布之后 `serving_json` / `feature_keys` / `metrics_json` 只读，要改就发新
版本（D8）——正因为不可变，provider 侧的版本缓存不需要任何失效机制。
"""

import uuid
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKeyConstraint,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import UuidPrimaryKeyMixin
from platform_server.apps.modeling.models.base import Base, CreatedAtMixin
from platform_server.apps.modeling.protocols import (
    MODEL_TASKS,
    SERVING_CHANNELS,
    sql_values,
)

# 二进制产物列（artifact / artifact_digest / sklearn_version）不在这张表上：
# ⚠ 版本表要被列表页全量读，加一列几十 MB 的 bytea 会让每次列表都拖着产物走。
# 要开二进制通道时照 `ac_model_artifacts` 的形状另起一张子表（§4.4）


class ModelingModelVersion(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """一个模型版本。`(pipeline_id, version)` 唯一，一次运行至多发布一个。"""

    __tablename__ = "modeling_model_versions"

    # ⚠ RESTRICT 而不是 CASCADE：删流水线前必须先退役它的模型，否则台账里
    # 一批公式会连着失去它们钉住的那一版
    pipeline_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    # ⚠ 同为 RESTRICT：被发布过的运行删不掉，故运行保留期清理必须先跳过
    # 它们（§6.5）
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    # 按流水线自增
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # 建模算子 code
    algo: Mapped[str] = mapped_column(Text, nullable=False)
    task: Mapped[str] = mapped_column(Text, nullable=False)
    # 能否被台账公式调用。⚠ 不可服务必须显式、可测、界面可见：静默放行的
    # 后果是用户上线了一个永远返回空的模型（D9）
    servable: Mapped[bool] = mapped_column(Boolean, nullable=False)
    serving_channel: Mapped[str] = mapped_column(Text, nullable=False)
    # 不可服务时的人话原因
    unservable_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 纯数据的可服务表示 `{format_version, task, input_columns, steps}`，
    # 形状见 §7.3。推理时不读文件、不反序列化任何二进制
    serving_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # 有序特征列 key，即**建模那一步**看到的列（特征工程之后）。
    # ⚠ 它不是对外的输入契约——契约在 `serving_json.entry_columns` 上，在特征
    # 工程之前。两者只在「没有任何算子增删列」时才相等
    feature_keys: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)
    # 模型签名：面向人与第三方系统的输入输出说明。**不参与任何计算**，
    # 推理只读 `serving_json`（docs/MODELING_PLATFORM_DESIGN.md D6）
    signature_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    target_key: Mapped[str] = mapped_column(Text, nullable=False)
    # 发布时冻结的评估指标
    metrics_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # `{format_version, python, numpy, sklearn, rows, since, until,
    # table_codes}`
    fingerprint_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ⚠ 冗余存一份用户名是刻意的：账号可能被删，而这一行要一直答得出「谁发的」
    created_by_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["pipeline_id"],
            ["platform.modeling_pipelines.id"],
            name="fk_modeling_model_versions_pipeline_id",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["run_id"],
            ["platform.modeling_runs.id"],
            name="fk_modeling_model_versions_run_id",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("run_id"),
        UniqueConstraint("pipeline_id", "version"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint("length(algo) > 0", name="algo_nonempty"),
        CheckConstraint("length(target_key) > 0", name="target_key_nonempty"),
        CheckConstraint(
            f"task IN ({sql_values(MODEL_TASKS)})", name="task_known"
        ),
        CheckConstraint(
            f"serving_channel IN ({sql_values(SERVING_CHANNELS)})",
            name="serving_channel_known",
        ),
        # 不可服务就必须留一句人话原因，界面才有得显示
        CheckConstraint(
            "servable OR unservable_reason IS NOT NULL",
            name="unservable_has_reason",
        ),
        # 特征列必须是数组且有序：存成对象就丢了顺序，而绑定是按位置映射的
        CheckConstraint(
            "jsonb_typeof(feature_keys) = 'array'",
            name="feature_keys_are_an_array",
        ),
        CheckConstraint(
            "jsonb_typeof(serving_json) = 'object'",
            name="serving_is_an_object",
        ),
        CheckConstraint(
            "jsonb_typeof(signature_json) = 'object'",
            name="signature_is_an_object",
        ),
        CheckConstraint(
            "jsonb_typeof(metrics_json) = 'object'",
            name="metrics_is_an_object",
        ),
        CheckConstraint(
            "jsonb_typeof(fingerprint_json) = 'object'",
            name="fingerprint_is_an_object",
        ),
    )
