"""扩展报告模板、生成记录、定时规则和审计表。"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d6a92e71b403"
down_revision: str | None = "c5a8b31d7e02"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        "report_audits",
        sa.Column("actor_id", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("trace_id", sa.Text(), nullable=False),
        sa.Column(
            "before_json",
            sa.JSON().with_variant(
                postgresql.JSONB(astext_type=sa.Text()), "postgresql"
            ),
            nullable=True,
        ),
        sa.Column(
            "after_json",
            sa.JSON().with_variant(
                postgresql.JSONB(astext_type=sa.Text()), "postgresql"
            ),
            nullable=True,
        ),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_report_audits")),
        schema="platform",
    )
    with op.get_context().autocommit_block():
        op.create_index(
            op.f("ix_report_audits_target_id"),
            "report_audits",
            ["target_id"],
            unique=False,
            schema="platform",
            postgresql_concurrently=True,
        )
    op.create_table(
        "report_templates",
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("granularity", sa.Text(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False),
        sa.Column("row_version", sa.Integer(), nullable=False),
        sa.Column(
            "body_json",
            sa.JSON().with_variant(
                postgresql.JSONB(astext_type=sa.Text()), "postgresql"
            ),
            nullable=False,
        ),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_report_templates")),
        sa.UniqueConstraint("code", name=op.f("uq_report_templates_code")),
        schema="platform",
    )
    op.create_table(
        "report_schedules",
        sa.Column("template_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("granularity", sa.Text(), nullable=False),
        sa.Column("delay_hours", sa.Integer(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False),
        sa.Column("row_version", sa.Integer(), nullable=False),
        sa.Column("last_run_period", sa.Text(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["template_id"],
            ["platform.report_templates.id"],
            name=op.f("fk_report_schedules_template_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_report_schedules")),
        schema="platform",
    )
    with op.get_context().autocommit_block():
        op.create_index(
            op.f("ix_report_schedules_template_id"),
            "report_schedules",
            ["template_id"],
            unique=False,
            schema="platform",
            postgresql_concurrently=True,
        )
    op.create_table(
        "report_renders",
        sa.Column("template_id", sa.UUID(), nullable=True),
        sa.Column("schedule_id", sa.UUID(), nullable=True),
        sa.Column("period", sa.Text(), nullable=False),
        sa.Column("granularity", sa.Text(), nullable=False),
        sa.Column("timezone", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column(
            "snapshot_json",
            sa.JSON().with_variant(
                postgresql.JSONB(astext_type=sa.Text()), "postgresql"
            ),
            nullable=False,
        ),
        sa.Column(
            "result_json",
            sa.JSON().with_variant(
                postgresql.JSONB(astext_type=sa.Text()), "postgresql"
            ),
            nullable=True,
        ),
        sa.Column(
            "warnings_json",
            sa.JSON().with_variant(
                postgresql.JSONB(astext_type=sa.Text()), "postgresql"
            ),
            nullable=False,
        ),
        sa.Column("object_key", sa.Text(), nullable=True),
        sa.Column("request_key", sa.Text(), nullable=True),
        sa.Column("request_hash", sa.Text(), nullable=True),
        sa.Column("traceparent", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["schedule_id"],
            ["platform.report_schedules.id"],
            name=op.f("fk_report_renders_schedule_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["template_id"],
            ["platform.report_templates.id"],
            name=op.f("fk_report_renders_template_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_report_renders")),
        sa.UniqueConstraint(
            "request_key", name="uq_report_renders_request_key"
        ),
        sa.UniqueConstraint(
            "schedule_id", "period", name="uq_report_renders_schedule_period"
        ),
        schema="platform",
    )
    with op.get_context().autocommit_block():
        op.create_index(
            op.f("ix_report_renders_schedule_id"),
            "report_renders",
            ["schedule_id"],
            unique=False,
            schema="platform",
            postgresql_concurrently=True,
        )
    with op.get_context().autocommit_block():
        op.create_index(
            op.f("ix_report_renders_template_id"),
            "report_renders",
            ["template_id"],
            unique=False,
            schema="platform",
            postgresql_concurrently=True,
        )
    with op.get_context().autocommit_block():
        op.create_index(
            op.f("ix_report_renders_status"),
            "report_renders",
            ["status"],
            unique=False,
            schema="platform",
            postgresql_concurrently=True,
        )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.drop_table("report_renders", schema="platform")
    op.drop_table("report_schedules", schema="platform")
    op.drop_table("report_templates", schema="platform")
    op.drop_table("report_audits", schema="platform")
