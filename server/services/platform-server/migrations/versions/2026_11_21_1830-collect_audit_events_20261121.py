"""扩展采集配置与写值的追加式审计存储。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "collect_audit_events_20261121"
down_revision: str | None = "modeling_cmd_origin_20261121"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "collect_audit_events"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.create_table(
        TABLE,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("source_ip", sa.Text()),
        sa.Column("trace_id", sa.Text(), nullable=False),
        sa.Column("target_kind", sa.Text(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("event_kind", sa.Text(), nullable=False),
        sa.Column("intent_id", sa.Uuid()),
        sa.Column("before_json", postgresql.JSONB()),
        sa.Column("after_json", postgresql.JSONB()),
        sa.Column("outcome_code", sa.Integer()),
        sa.PrimaryKeyConstraint("id", name="pk_collect_audit_events"),
        sa.ForeignKeyConstraint(
            ["intent_id"],
            ["platform.collect_audit_events.id"],
            name="fk_collect_audit_event_intent",
        ),
        sa.UniqueConstraint("intent_id", name="uq_collect_audit_event_intent"),
        sa.CheckConstraint(
            "target_kind IN ('source', 'point')",
            name="ck_collect_audit_target_kind",
        ),
        sa.CheckConstraint(
            "(event_kind IN ('created', 'updated', 'deleted') "
            "AND intent_id IS NULL) OR "
            "(target_kind = 'point' AND ("
            "(event_kind = 'write_intent' AND intent_id IS NULL) OR "
            "(event_kind IN ('write_confirmed', 'write_rejected', "
            "'write_unconfirmed') AND intent_id IS NOT NULL)))",
            name="ck_collect_audit_event_kind",
        ),
        schema="platform",
    )
    op.create_index(
        "ix_collect_audit_events_target",
        TABLE,
        ["target_kind", "target_id", "created_at", "id"],
        schema="platform",
    )
    _protect_events()


def _protect_events() -> None:
    """禁止 SQL 改写、删除或清空已经插入的事件。"""
    op.execute("""
        CREATE FUNCTION platform.reject_collect_audit_mutation()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'collect audit events are append-only'
                USING ERRCODE = '55000';
        END;
        $$
        """)
    op.execute("""
        CREATE TRIGGER collect_audit_events_append_only
        BEFORE UPDATE OR DELETE OR TRUNCATE ON platform.collect_audit_events
        FOR EACH STATEMENT
        EXECUTE FUNCTION platform.reject_collect_audit_mutation()
        """)


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.drop_table(TABLE, schema="platform")
    op.execute("DROP FUNCTION platform.reject_collect_audit_mutation()")
