"""加大屏组态的四张表（docs/DASHBOARD_DESIGN.md §2.1）。

四张都是新建表，索引随建表一起下，不需要 CONCURRENTLY。来源种类用 text + CHECK
不用原生 ENUM。`row_version`（乐观锁）与 `schema_version`（格式版本）是两列。

Revision ID: f1a72c3b95d4
Revises: e85b3c9f26d4
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f1a72c3b95d4"
down_revision: str | None = "e85b3c9f26d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# ⚠ 与 apps/dashboard/source_kinds.py 同口径。那边加取值时，这里要跟一条新迁移
# 改 CHECK——两边分叉的表现是写入被数据库拒绝而代码看起来完全正确。
_SOURCE_KINDS = "'archive', 'computed', 'opcua', 'static'"
_EMPTY_JSON = sa.text("'{}'::jsonb")


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_projects()
    _create_dashboards()
    _create_nodes()
    _create_bindings()


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("dashboard_bindings", schema="platform")
    op.drop_table("dashboard_nodes", schema="platform")
    op.drop_table("dashboards", schema="platform")
    op.drop_table("dashboard_projects", schema="platform")


def _timestamps() -> tuple[sa.Column[datetime], sa.Column[datetime]]:
    """两列建表时刻。时刻一律 timestamptz 存 UTC。"""
    return (
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
    )


def _create_projects() -> None:
    op.create_table(
        "dashboard_projects",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "theme_json",
            postgresql.JSONB(),
            server_default=_EMPTY_JSON,
            nullable=False,
        ),
        sa.Column(
            "brand_json",
            postgresql.JSONB(),
            server_default=_EMPTY_JSON,
            nullable=False,
        ),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_dashboard_projects"),
        sa.CheckConstraint(
            "length(name) > 0", name="ck_dashboard_projects_name_nonempty"
        ),
        schema="platform",
    )


def _create_dashboards() -> None:
    op.create_table(
        "dashboards",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "design_width",
            sa.Integer(),
            server_default=sa.text("1920"),
            nullable=False,
        ),
        sa.Column(
            "design_height",
            sa.Integer(),
            server_default=sa.text("1080"),
            nullable=False,
        ),
        sa.Column(
            "theme_json",
            postgresql.JSONB(),
            server_default=_EMPTY_JSON,
            nullable=False,
        ),
        sa.Column(
            "chrome_json",
            postgresql.JSONB(),
            server_default=_EMPTY_JSON,
            nullable=False,
        ),
        sa.Column(
            "row_version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column(
            "schema_version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column(
            "is_public",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("public_token", sa.Text(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_dashboards"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["platform.dashboard_projects.id"],
            name="fk_dashboards_project_id",
        ),
        sa.UniqueConstraint("public_token", name="uq_dashboards_public_token"),
        sa.CheckConstraint(
            "length(name) > 0", name="ck_dashboards_name_nonempty"
        ),
        sa.CheckConstraint(
            "design_width > 0 AND design_height > 0",
            name="ck_dashboards_design_size_positive",
        ),
        sa.CheckConstraint(
            "row_version >= 1", name="ck_dashboards_row_version_positive"
        ),
        sa.CheckConstraint(
            "schema_version >= 1", name="ck_dashboards_schema_version_positive"
        ),
        sa.CheckConstraint(
            "NOT is_public OR public_token IS NOT NULL",
            name="ck_dashboards_public_has_token",
        ),
        schema="platform",
    )
    op.create_index(
        "ix_dashboards_project_id",
        "dashboards",
        ["project_id"],
        schema="platform",
    )


def _create_nodes() -> None:
    op.create_table(
        "dashboard_nodes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("dashboard_id", sa.UUID(), nullable=False),
        sa.Column("parent_id", sa.UUID(), nullable=True),
        sa.Column("client_key", sa.Text(), nullable=True),
        sa.Column("module_type", sa.Text(), nullable=False),
        sa.Column("x", sa.Integer(), nullable=False),
        sa.Column("y", sa.Integer(), nullable=False),
        sa.Column("w", sa.Integer(), nullable=False),
        sa.Column("h", sa.Integer(), nullable=False),
        sa.Column(
            "z_index", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "is_visible",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "config_json",
            postgresql.JSONB(),
            server_default=_EMPTY_JSON,
            nullable=False,
        ),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_dashboard_nodes"),
        sa.ForeignKeyConstraint(
            ["dashboard_id"],
            ["platform.dashboards.id"],
            name="fk_dashboard_nodes_dashboard_id",
            ondelete="CASCADE",
        ),
        # 撞键 409 而不是先到先得：静默合并会让第二个节点被并进第一个
        sa.UniqueConstraint(
            "dashboard_id",
            "client_key",
            name="uq_dashboard_nodes_dashboard_id_client_key",
        ),
        # ⚠ 父子外键带上 dashboard_id：单列外键拦不住「父节点在另一张大屏上」
        sa.UniqueConstraint(
            "id", "dashboard_id", name="uq_dashboard_nodes_id_dashboard_id"
        ),
        sa.ForeignKeyConstraint(
            ["parent_id", "dashboard_id"],
            [
                "platform.dashboard_nodes.id",
                "platform.dashboard_nodes.dashboard_id",
            ],
            name="fk_dashboard_nodes_parent_id",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "w > 0 AND h > 0", name="ck_dashboard_nodes_size_positive"
        ),
        sa.CheckConstraint(
            "parent_id IS NULL OR parent_id <> id",
            name="ck_dashboard_nodes_no_self_parent",
        ),
        sa.CheckConstraint(
            "length(module_type) BETWEEN 1 AND 64",
            name="ck_dashboard_nodes_module_type_sized",
        ),
        sa.CheckConstraint(
            "client_key IS NULL OR length(client_key) BETWEEN 1 AND 128",
            name="ck_dashboard_nodes_client_key_sized",
        ),
        schema="platform",
    )
    op.create_index(
        "ix_dashboard_nodes_dashboard_id",
        "dashboard_nodes",
        ["dashboard_id"],
        schema="platform",
    )
    op.create_index(
        "ix_dashboard_nodes_parent_id",
        "dashboard_nodes",
        ["parent_id"],
        schema="platform",
    )


def _create_bindings() -> None:
    op.create_table(
        "dashboard_bindings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("node_id", sa.UUID(), nullable=False),
        sa.Column("field_key", sa.Text(), nullable=False),
        sa.Column("source_kind", sa.Text(), nullable=False),
        sa.Column("node_key", sa.Text(), nullable=True),
        sa.Column("static_value_json", postgresql.JSONB(), nullable=True),
        sa.Column("compute_json", postgresql.JSONB(), nullable=True),
        sa.Column("detail_json", postgresql.JSONB(), nullable=True),
        sa.Column("transform_json", postgresql.JSONB(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_dashboard_bindings"),
        sa.ForeignKeyConstraint(
            ["node_id"],
            ["platform.dashboard_nodes.id"],
            name="fk_dashboard_bindings_node_id",
            ondelete="CASCADE",
        ),
        # 同一个槽被绑两次时，取哪个就只看行序了
        sa.UniqueConstraint(
            "node_id",
            "field_key",
            name="uq_dashboard_bindings_node_id_field_key",
        ),
        sa.CheckConstraint(
            f"source_kind IN ({_SOURCE_KINDS})",
            name="ck_dashboard_bindings_source_kind_known",
        ),
        sa.CheckConstraint(
            "length(field_key) BETWEEN 1 AND 128",
            name="ck_dashboard_bindings_field_key_sized",
        ),
        sa.CheckConstraint(
            "node_key IS NULL OR length(node_key) BETWEEN 1 AND 256",
            name="ck_dashboard_bindings_node_key_sized",
        ),
        sa.CheckConstraint(
            "source_kind <> 'opcua' OR node_key IS NOT NULL",
            name="ck_dashboard_bindings_opcua_has_node_key",
        ),
        schema="platform",
    )
    op.create_index(
        "ix_dashboard_bindings_node_id",
        "dashboard_bindings",
        ["node_id"],
        schema="platform",
    )
