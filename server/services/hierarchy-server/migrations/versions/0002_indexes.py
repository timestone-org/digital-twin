"""独立建立查询索引，允许并发索引失败后重新执行。"""

from alembic import op

revision = "hierarchy_0002"
down_revision = "hierarchy_0001"
branch_labels = None
depends_on = None
SCHEMA = "hierarchy"
INDEXES = (
    ("ix_hierarchy_projects_owner_id", "hierarchy_projects", "owner_id"),
    ("ix_hierarchy_versions_project_id", "hierarchy_versions", "project_id"),
)


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        for name, table, column in INDEXES:
            op.drop_index(
                name,
                table_name=table,
                schema=SCHEMA,
                if_exists=True,
                postgresql_concurrently=True,
            )
            op.create_index(
                name,
                table,
                [column],
                schema=SCHEMA,
                postgresql_concurrently=True,
            )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        for name, table, _column in reversed(INDEXES):
            op.drop_index(
                name,
                table_name=table,
                schema=SCHEMA,
                if_exists=True,
                postgresql_concurrently=True,
            )
