"""建模命令结构完成后的独立并发审计索引阶段。"""

from collections.abc import Sequence

from alembic import op

revision: str = "modeling_commands_idx_20261030"
down_revision: str | None = "modeling_commands_20261030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEX_NAME = "ix_modeling_operator_audits_command_id"
TABLE_NAME = "modeling_operator_audits"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        op.drop_index(
            INDEX_NAME,
            table_name=TABLE_NAME,
            schema="platform",
            if_exists=True,
            postgresql_concurrently=True,
        )
        op.create_index(
            INDEX_NAME,
            TABLE_NAME,
            ["command_id"],
            schema="platform",
            postgresql_concurrently=True,
        )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        op.drop_index(
            INDEX_NAME,
            table_name=TABLE_NAME,
            schema="platform",
            if_exists=True,
            postgresql_concurrently=True,
        )
