"""模型管理结构完成后的独立并发索引阶段，可从索引故障续跑。"""

from collections.abc import Sequence

from alembic import op

revision: str = "modeling_management_idx_20261030"
down_revision: str | None = "modeling_management_20261030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ARCHIVE_TABLES = (
    "modeling_instances",
    "modeling_model_versions",
    "modeling_rule_versions",
)
SWITCH_COLUMNS = (
    "deployment_id",
    "rollback_of_id",
    "from_model_id",
    "from_rule_id",
    "to_model_id",
    "to_rule_id",
)
INDEXES = (
    *(
        (
            f"ix_{table}_archive_created",
            table,
            ("archived_at", "created_at", "id"),
        )
        for table in ARCHIVE_TABLES
    ),
    (
        "ix_modeling_runs_pipeline_created_id",
        "modeling_runs",
        ("pipeline_id", "created_at", "id"),
    ),
    *(
        (
            f"ix_modeling_switches_{column}",
            "modeling_deployment_switches",
            (column,),
        )
        for column in SWITCH_COLUMNS
    ),
)


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        for name, table, columns in INDEXES:
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
                list(columns),
                schema="platform",
                postgresql_concurrently=True,
            )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        for name, table, _columns in reversed(INDEXES):
            op.drop_index(
                name,
                table_name=table,
                schema="platform",
                if_exists=True,
                postgresql_concurrently=True,
            )
