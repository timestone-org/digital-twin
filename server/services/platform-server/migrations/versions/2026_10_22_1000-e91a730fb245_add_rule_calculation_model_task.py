"""规则版本独立存储与可选部署引用，兼容旧模型读取端。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e91a730fb245"
down_revision: str | None = "d81e620fa934"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MODEL_TASKS = "'anomaly_detection', 'classification', 'regression'"
RULE_TASK = "rule_calculation"
TABLE = "platform.modeling_rule_versions"
DEPLOYMENTS = "platform.modeling_deployments"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_rule_versions()
    op.add_column(
        "modeling_deployments",
        sa.Column(
            "rule_version_id", postgresql.UUID(as_uuid=True), nullable=True
        ),
        schema="platform",
    )
    op.alter_column(
        "modeling_deployments",
        "model_version_id",
        nullable=True,
        schema="platform",
    )
    op.execute(
        f"ALTER TABLE {DEPLOYMENTS} ADD CONSTRAINT "
        "fk_modeling_deployments_rule_version_id FOREIGN KEY (rule_version_id) "
        f"REFERENCES {TABLE} (id) ON DELETE RESTRICT NOT VALID"
    )
    op.execute(
        f"ALTER TABLE {DEPLOYMENTS} ADD CONSTRAINT "
        "ck_modeling_deployments_exactly_one_version CHECK "
        "((model_version_id IS NULL) <> (rule_version_id IS NULL)) NOT VALID"
    )
    for name in (
        "fk_modeling_deployments_rule_version_id",
        "ck_modeling_deployments_exactly_one_version",
    ):
        op.execute(f"ALTER TABLE {DEPLOYMENTS} VALIDATE CONSTRAINT {name}")


def _create_rule_versions() -> None:
    op.create_table(
        "modeling_rule_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("pipeline_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("algo", sa.Text(), nullable=False),
        sa.Column("task", sa.Text(), nullable=False),
        sa.Column("servable", sa.Boolean(), nullable=False),
        sa.Column("serving_channel", sa.Text(), nullable=False),
        sa.Column("unservable_reason", sa.Text(), nullable=True),
        sa.Column("serving_json", postgresql.JSONB(), nullable=False),
        sa.Column("feature_keys", postgresql.JSONB(), nullable=False),
        sa.Column(
            "signature_json",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("target_key", sa.Text(), nullable=True),
        sa.Column("metrics_json", postgresql.JSONB(), nullable=False),
        sa.Column("fingerprint_json", postgresql.JSONB(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_by_name", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_modeling_rule_versions"),
        sa.ForeignKeyConstraint(
            ["pipeline_id"],
            ["platform.modeling_pipelines.id"],
            name="fk_modeling_rule_versions_pipeline_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["platform.modeling_runs.id"],
            name="fk_modeling_rule_versions_run_id",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("run_id", name="uq_modeling_rule_versions_run_id"),
        sa.UniqueConstraint(
            "pipeline_id",
            "version",
            name="uq_modeling_rule_versions_pipeline_id_version",
        ),
        schema="platform",
    )
    _rule_constraints()


def _rule_constraints() -> None:
    definitions = {
        "version_positive": "version >= 1",
        "name_nonempty": "length(name) > 0",
        "algo_known": "algo = 'energy_rules'",
        "task_known": "task = 'rule_calculation'",
        "target_is_null": "target_key IS NULL",
        "serving_channel_known": "serving_channel = 'json'",
        "unservable_has_reason": "servable OR unservable_reason IS NOT NULL",
        "feature_keys_are_an_array": "jsonb_typeof(feature_keys) = 'array'",
        "serving_is_an_object": "jsonb_typeof(serving_json) = 'object'",
        "signature_is_an_object": "jsonb_typeof(signature_json) = 'object'",
        "metrics_is_an_object": "jsonb_typeof(metrics_json) = 'object'",
        "fingerprint_is_an_object": "jsonb_typeof(fingerprint_json) = 'object'",
    }
    for name, expression in definitions.items():
        constraint = f"ck_modeling_rule_versions_{name}"
        op.execute(
            f"ALTER TABLE {TABLE} ADD CONSTRAINT {constraint} "
            f"CHECK ({expression}) NOT VALID"
        )
        op.execute(f"ALTER TABLE {TABLE} VALIDATE CONSTRAINT {constraint}")


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    found = (
        op.get_bind()
        .execute(
            sa.text("SELECT 1 FROM platform.modeling_rule_versions LIMIT 1")
        )
        .scalar()
    )
    if found is not None:
        raise RuntimeError("已有规则计算模型，不能收缩为不支持该任务的结构")
    op.execute(
        f"ALTER TABLE {DEPLOYMENTS} DROP CONSTRAINT "
        "ck_modeling_deployments_exactly_one_version"
    )
    op.execute(
        f"ALTER TABLE {DEPLOYMENTS} DROP CONSTRAINT "
        "fk_modeling_deployments_rule_version_id"
    )
    op.drop_column("modeling_deployments", "rule_version_id", schema="platform")
    op.alter_column(
        "modeling_deployments",
        "model_version_id",
        nullable=False,
        schema="platform",
    )
    op.drop_table("modeling_rule_versions", schema="platform")
