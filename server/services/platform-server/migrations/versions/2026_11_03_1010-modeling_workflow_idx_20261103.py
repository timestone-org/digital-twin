"""定时规则结构之后的可续跑并发索引阶段。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "modeling_workflow_idx_20261103"
down_revision: str | None = "modeling_workflow_20261103"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEXES = (
    (
        "modeling_runs",
        "ix_modeling_runs_publication_deployment_id",
        ["publication_deployment_id"],
        None,
    ),
    (
        "modeling_runs",
        "ix_modeling_runs_dispatch_after",
        ["dispatch_after", "id"],
        "status = 'pending' OR (status = 'cancelling' AND attempt = 0)",
    ),
    (
        "modeling_schedules",
        "ix_modeling_schedules_last_run_id",
        ["last_run_id"],
        None,
    ),
    (
        "modeling_schedules",
        "ix_modeling_schedules_next_run_at",
        ["next_run_at", "pipeline_id"],
        "is_enabled",
    ),
)


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        for table, name, columns, predicate in INDEXES:
            op.drop_index(
                name,
                table_name=table,
                schema="platform",
                if_exists=True,
                postgresql_concurrently=True,
            )
            op.create_index(
                name,
                table,
                columns,
                schema="platform",
                postgresql_concurrently=True,
                postgresql_where=sa.text(predicate) if predicate else None,
            )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        for table, name, _columns, _predicate in INDEXES:
            op.drop_index(
                name,
                table_name=table,
                schema="platform",
                if_exists=True,
                postgresql_concurrently=True,
            )
