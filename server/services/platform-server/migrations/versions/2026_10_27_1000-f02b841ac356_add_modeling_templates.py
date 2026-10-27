"""新增建模模板、实例与配置审计；不修改存量流水线。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f02b841ac356"
down_revision: str | None = "e91a730fb245"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _templates()
    _instances()
    _audits()
    with op.get_context().autocommit_block():
        for table, column in (
            ("modeling_templates", "pipeline_id"),
            ("modeling_instances", "template_id"),
            ("modeling_configuration_audits", "target_id"),
        ):
            op.create_index(
                f"ix_{table}_{column}",
                table,
                [column],
                schema="platform",
                postgresql_concurrently=True,
            )


def _templates() -> None:
    op.create_table(
        "modeling_templates",
        sa.Column("id", postgresql.UUID(), nullable=False),
        sa.Column("pipeline_id", postgresql.UUID(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("graph_json", postgresql.JSONB(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("created_by_name", sa.Text(), nullable=False),
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
        sa.PrimaryKeyConstraint("id", name="pk_modeling_templates"),
        sa.ForeignKeyConstraint(
            ["pipeline_id"],
            ["platform.modeling_pipelines.id"],
            ondelete="RESTRICT",
            name="fk_modeling_templates_pipeline_id_modeling_pipelines",
        ),
        sa.UniqueConstraint(
            "pipeline_id",
            "version",
            name="uq_modeling_templates_pipeline_id_version",
        ),
        sa.CheckConstraint(
            "version > 0", name="ck_modeling_templates_version_positive"
        ),
        sa.CheckConstraint(
            "length(name) > 0", name="ck_modeling_templates_name_nonempty"
        ),
        sa.CheckConstraint(
            "jsonb_typeof(graph_json) = 'object'",
            name="ck_modeling_templates_graph_object",
        ),
        schema="platform",
    )


def _instances() -> None:
    op.create_table(
        "modeling_instances",
        sa.Column("id", postgresql.UUID(), nullable=False),
        sa.Column("template_id", postgresql.UUID(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
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
        sa.PrimaryKeyConstraint("id", name="pk_modeling_instances"),
        sa.ForeignKeyConstraint(
            ["id"],
            ["platform.modeling_pipelines.id"],
            ondelete="RESTRICT",
            name="fk_modeling_instances_id_modeling_pipelines",
        ),
        sa.ForeignKeyConstraint(
            ["template_id"],
            ["platform.modeling_templates.id"],
            ondelete="RESTRICT",
            name="fk_modeling_instances_template_id_modeling_templates",
        ),
        sa.CheckConstraint(
            "revision > 0", name="ck_modeling_instances_revision_positive"
        ),
        schema="platform",
    )


def _audits() -> None:
    op.create_table(
        "modeling_configuration_audits",
        sa.Column("id", postgresql.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("actor_id", sa.Text(), nullable=False),
        sa.Column("source_ip", sa.Text(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target_id", postgresql.UUID(), nullable=False),
        sa.Column("trace_id", sa.Text(), nullable=False),
        sa.Column("before_json", postgresql.JSONB(), nullable=True),
        sa.Column("after_json", postgresql.JSONB(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_modeling_configuration_audits"),
        schema="platform",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("modeling_configuration_audits", schema="platform")
    op.drop_table("modeling_instances", schema="platform")
    op.drop_table("modeling_templates", schema="platform")
