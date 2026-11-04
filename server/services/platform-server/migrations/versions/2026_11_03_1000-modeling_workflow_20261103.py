"""新增定时训练规则与训练后发布状态；不回填既有记录。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "modeling_workflow_20261103"
down_revision: str | None = "modeling_commands_idx_20261030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    for name, kind in (
        ("auto_publish", sa.Boolean()),
        ("publication_status", sa.Text()),
        ("publication_error", sa.Text()),
        ("publication_expected_revision", sa.Integer()),
        ("publication_deployment_id", postgresql.UUID()),
        ("dispatch_after", sa.DateTime(timezone=True)),
        ("traceparent", sa.Text()),
    ):
        op.add_column(
            "modeling_runs",
            sa.Column(name, kind, nullable=True),
            schema="platform",
        )
    op.execute(
        "ALTER TABLE platform.modeling_runs ADD CONSTRAINT "
        "fk_modeling_runs_publication_deployment_id FOREIGN KEY "
        "(publication_deployment_id) REFERENCES "
        "platform.modeling_deployments (id) ON DELETE SET NULL NOT VALID"
    )
    op.execute(
        "ALTER TABLE platform.modeling_runs VALIDATE CONSTRAINT "
        "fk_modeling_runs_publication_deployment_id"
    )
    _trigger("'api', 'manual', 'schedule'")
    _schedules()


def _trigger(values: str) -> None:
    op.drop_constraint(
        "ck_modeling_runs_trigger_known",
        "modeling_runs",
        schema="platform",
        type_="check",
    )
    op.execute(
        sa.text(
            "ALTER TABLE platform.modeling_runs ADD CONSTRAINT "
            "ck_modeling_runs_trigger_known "
            f"CHECK (trigger IN ({values})) NOT VALID"
        )
    )
    op.execute(
        "ALTER TABLE platform.modeling_runs VALIDATE CONSTRAINT "
        "ck_modeling_runs_trigger_known"
    )


def _schedules() -> None:
    op.create_table(
        "modeling_schedules",
        sa.Column("pipeline_id", postgresql.UUID(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False),
        sa.Column("interval_minutes", sa.Integer(), nullable=False),
        sa.Column("auto_publish", sa.Boolean(), nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_id", postgresql.UUID(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.Text(), nullable=False),
        sa.Column("actor_name", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("pipeline_id", name="pk_modeling_schedules"),
        sa.ForeignKeyConstraint(
            ["pipeline_id"],
            ["platform.modeling_pipelines.id"],
            name="fk_modeling_schedules_pipeline_id_modeling_pipelines",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["last_run_id"],
            ["platform.modeling_runs.id"],
            name="fk_modeling_schedules_last_run_id_modeling_runs",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "interval_minutes BETWEEN 5 AND 525600",
            name="ck_modeling_schedules_interval_valid",
        ),
        sa.CheckConstraint(
            "revision > 0", name="ck_modeling_schedules_revision_positive"
        ),
        sa.CheckConstraint(
            "NOT is_enabled OR next_run_at IS NOT NULL",
            name="ck_modeling_schedules_enabled_has_due",
        ),
        schema="platform",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _trigger("'api', 'manual'")
    op.drop_table("modeling_schedules", schema="platform")
    op.drop_constraint(
        "fk_modeling_runs_publication_deployment_id",
        "modeling_runs",
        schema="platform",
        type_="foreignkey",
    )
    for name in (
        "traceparent",
        "dispatch_after",
        "publication_deployment_id",
        "publication_expected_revision",
        "publication_error",
        "publication_status",
        "auto_publish",
    ):
        op.drop_column("modeling_runs", name, schema="platform")
