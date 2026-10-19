"""创建层级图项目与保存版本。"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "hierarchy_0001"
down_revision = None
branch_labels = None
depends_on = None
SCHEMA = "hierarchy"


def timestamps():
    return [
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
    ]


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        "hierarchy_projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("node_count", sa.Integer(), nullable=False),
        sa.Column("document", postgresql.JSONB(), nullable=False),
        sa.Column("creation_hash", sa.Text(), nullable=False),
        *timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_hierarchy_projects"),
        sa.CheckConstraint(
            "revision > 0", name="ck_hierarchy_projects_revision_positive"
        ),
        schema=SCHEMA,
    )
    op.create_table(
        "hierarchy_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("document", postgresql.JSONB(), nullable=False),
        *timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_hierarchy_versions"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["hierarchy.hierarchy_projects.id"],
            name="fk_hierarchy_versions_project_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "project_id",
            "revision",
            name="uq_hierarchy_versions_project_id_revision",
        ),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("hierarchy_versions", schema=SCHEMA)
    op.drop_table("hierarchy_projects", schema=SCHEMA)
