"""扩展模型归档、部署修订和切换关系，不修改存量数据。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "modeling_management_20261030"
down_revision: str | None = "f02b841ac356"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

VERSION_TABLES = ("modeling_model_versions", "modeling_rule_versions")


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    for table in ("modeling_instances", *VERSION_TABLES):
        op.add_column(
            table,
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
            schema="platform",
        )
    op.add_column(
        "modeling_deployments",
        sa.Column("revision", sa.Integer(), nullable=True),
        schema="platform",
    )
    _switches()


def _switches() -> None:
    op.create_table(
        "modeling_deployment_switches",
        sa.Column("id", postgresql.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("deployment_id", postgresql.UUID(), nullable=True),
        sa.Column("deployment_code", sa.Text(), nullable=False),
        sa.Column("from_model_id", postgresql.UUID(), nullable=True),
        sa.Column("from_rule_id", postgresql.UUID(), nullable=True),
        sa.Column("to_model_id", postgresql.UUID(), nullable=True),
        sa.Column("to_rule_id", postgresql.UUID(), nullable=True),
        sa.Column("rollback_of_id", postgresql.UUID(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column(
            "is_signature_change_confirmed", sa.Boolean(), nullable=False
        ),
        sa.Column("created_by_name", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_modeling_deployment_switches"),
        sa.ForeignKeyConstraint(
            ["deployment_id"],
            ["platform.modeling_deployments.id"],
            ondelete="SET NULL",
            name="fk_modeling_switches_deployment",
        ),
        sa.ForeignKeyConstraint(
            ["rollback_of_id"],
            ["platform.modeling_deployment_switches.id"],
            ondelete="RESTRICT",
            name="fk_modeling_switches_rollback",
        ),
        *_version_constraints(),
        sa.CheckConstraint(
            "(from_model_id IS NULL) <> (from_rule_id IS NULL)",
            name="ck_modeling_deployment_switches_one_source",
        ),
        sa.CheckConstraint(
            "(to_model_id IS NULL) <> (to_rule_id IS NULL)",
            name="ck_modeling_deployment_switches_one_target",
        ),
        sa.CheckConstraint(
            "revision > 1",
            name="ck_modeling_deployment_switches_revision_positive",
        ),
        schema="platform",
    )


def _version_constraints() -> list[sa.ForeignKeyConstraint]:
    return [
        sa.ForeignKeyConstraint(
            [f"{direction}_{kind}_id"],
            [f"platform.{table}.id"],
            ondelete="RESTRICT",
            name=f"fk_modeling_switches_{direction}_{kind}",
        )
        for direction in ("from", "to")
        for kind, table in zip(("model", "rule"), VERSION_TABLES, strict=True)
    ]


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("modeling_deployment_switches", schema="platform")
    op.drop_column("modeling_deployments", "revision", schema="platform")
    for table in ("modeling_instances", *VERSION_TABLES):
        op.drop_column(table, "archived_at", schema="platform")
