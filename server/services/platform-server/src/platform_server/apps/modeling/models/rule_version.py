"""规则版本独立存储，旧模型读取端继续读取原有任务集合。"""

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, UniqueConstraint

from platform_server.apps.modeling.models.base import Base
from platform_server.apps.modeling.models.model_version import (
    ModelVersionFields,
)


class ModelingRuleVersion(ModelVersionFields, Base):
    """一次规则验证运行发布的不可变计算内容。"""

    __tablename__ = "modeling_rule_versions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["pipeline_id"],
            ["platform.modeling_pipelines.id"],
            name="fk_modeling_rule_versions_pipeline_id",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["run_id"],
            ["platform.modeling_runs.id"],
            name="fk_modeling_rule_versions_run_id",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("run_id"),
        UniqueConstraint("pipeline_id", "version"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint("algo = 'energy_rules'", name="algo_known"),
        CheckConstraint("task = 'rule_calculation'", name="task_known"),
        CheckConstraint("target_key IS NULL", name="target_is_null"),
        CheckConstraint(
            "serving_channel = 'json'", name="serving_channel_known"
        ),
        CheckConstraint(
            "servable OR unservable_reason IS NOT NULL",
            name="unservable_has_reason",
        ),
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
