"""工作台补齐：缩略图、模板、项目自定义主题、运行参数覆盖。

三张新表 + 一列新加。索引随建表一起下，故不需要 CONCURRENTLY；
`dashboard_projects.custom_themes_json` 带非 volatile 默认值 `'[]'::jsonb`，
加列不重写全表，且旧代码不认识这一列也照常插得进行（扩展步）。

⚠ `dashboard_templates.source_project_id` **刻意不建外键**：模板要活得比来源
项目久，建了外键就会「删项目连模板一起级联带走」。

Revision ID: c8e5301fa9d7
Revises: b7d419e2c85a
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c8e5301fa9d7"
down_revision: str | None = "b7d419e2c85a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_EMPTY_JSON = sa.text("'{}'::jsonb")
_EMPTY_JSON_ARRAY = sa.text("'[]'::jsonb")
# 与 models/thumbnail.py 的 MAX_THUMBNAIL_CHARS 同口径：两边分叉的表现是
# 写入被数据库拒绝而代码看起来完全正确
_MAX_THUMBNAIL_CHARS = 1_572_864
_THEMES_ARRAY_CHECK = "ck_dashboard_projects_custom_themes_is_array"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_thumbnails()
    _create_templates()
    _create_runtime_param_overrides()
    _add_project_custom_themes()


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_constraint(
        _THEMES_ARRAY_CHECK, "dashboard_projects", schema=_SCHEMA
    )
    op.drop_column("dashboard_projects", "custom_themes_json", schema=_SCHEMA)
    op.drop_table("runtime_param_overrides", schema=_SCHEMA)
    op.drop_table("dashboard_templates", schema=_SCHEMA)
    op.drop_table("dashboard_thumbnails", schema=_SCHEMA)


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


def _create_thumbnails() -> None:
    """一屏一张缩略图。独立成表，免得列表查询每次拖几 MB base64。"""
    created_at, updated_at = _timestamps()
    op.create_table(
        "dashboard_thumbnails",
        sa.Column("dashboard_id", sa.UUID(), nullable=False),
        sa.Column("data", sa.Text(), nullable=False),
        created_at,
        updated_at,
        sa.PrimaryKeyConstraint("dashboard_id", name="pk_dashboard_thumbnails"),
        sa.ForeignKeyConstraint(
            ["dashboard_id"],
            [f"{_SCHEMA}.dashboards.id"],
            name="fk_dashboard_thumbnails_dashboard_id_dashboards",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            f"length(data) BETWEEN 1 AND {_MAX_THUMBNAIL_CHARS}",
            name="ck_dashboard_thumbnails_data_len_in_range",
        ),
        schema=_SCHEMA,
    )


def _create_templates() -> None:
    """整屏模板：一份导出包 + 一张缩略图，全局可见。"""
    created_at, updated_at = _timestamps()
    op.create_table(
        "dashboard_templates",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.Text(), nullable=True),
        sa.Column("thumbnail", sa.Text(), nullable=True),
        sa.Column(
            "payload_json",
            postgresql.JSONB(),
            server_default=_EMPTY_JSON,
            nullable=False,
        ),
        sa.Column("source_project_id", sa.UUID(), nullable=True),
        created_at,
        updated_at,
        sa.PrimaryKeyConstraint("id", name="pk_dashboard_templates"),
        sa.CheckConstraint(
            "length(name) > 0", name="ck_dashboard_templates_name_nonempty"
        ),
        sa.CheckConstraint(
            "category IS NULL OR length(category) > 0",
            name="ck_dashboard_templates_category_nonempty",
        ),
        schema=_SCHEMA,
    )
    op.create_index(
        "ix_dashboard_templates_category",
        "dashboard_templates",
        ["category"],
        schema=_SCHEMA,
    )


def _create_runtime_param_overrides() -> None:
    """只存被改过的项：删行即恢复默认，此后重新跟随环境变量。"""
    op.create_table(
        "runtime_param_overrides",
        sa.Column("section", sa.Text(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("value_json", postgresql.JSONB(), nullable=False),
        sa.Column("previous_value_json", postgresql.JSONB(), nullable=True),
        sa.Column("updated_by", sa.Text(), server_default="", nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint(
            "section", "key", name="pk_runtime_param_overrides"
        ),
        sa.CheckConstraint(
            "length(section) > 0",
            name="ck_runtime_param_overrides_section_nonempty",
        ),
        sa.CheckConstraint(
            "length(key) > 0", name="ck_runtime_param_overrides_key_nonempty"
        ),
        schema=_SCHEMA,
    )


def _add_project_custom_themes() -> None:
    """项目自定义主题数组。非 volatile 默认值，加列不重写全表。"""
    op.add_column(
        "dashboard_projects",
        sa.Column(
            "custom_themes_json",
            postgresql.JSONB(),
            server_default=_EMPTY_JSON_ARRAY,
            nullable=False,
        ),
        schema=_SCHEMA,
    )
    # 存量行由 DEFAULT 填成 '[]'，校验瞬时完成；口径不因此破例，仍走两步
    op.execute(
        f"ALTER TABLE {_SCHEMA}.dashboard_projects "
        f"ADD CONSTRAINT {_THEMES_ARRAY_CHECK} "
        "CHECK (jsonb_typeof(custom_themes_json) = 'array') NOT VALID"
    )
    op.execute(
        f"ALTER TABLE {_SCHEMA}.dashboard_projects "
        f"VALIDATE CONSTRAINT {_THEMES_ARRAY_CHECK}"
    )
