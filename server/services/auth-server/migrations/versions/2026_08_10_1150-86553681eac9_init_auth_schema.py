"""建 auth schema 的初始结构：用户、角色、权限码、路由规则、审计。

schema 由 env.py 在迁移前 CREATE IF NOT EXISTS。

Revision ID: 86553681eac9
Revises:
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "86553681eac9"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        "auth_audit_logs",
        sa.Column("actor_id", sa.UUID(), nullable=True),
        sa.Column("actor_username", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target_type", sa.Text(), nullable=False),
        sa.Column("target_id", sa.Text(), nullable=True),
        sa.Column(
            "before", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column(
            "after", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("source_ip", sa.Text(), nullable=True),
        sa.Column("trace_id", sa.Text(), nullable=True),
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
        sa.CheckConstraint(
            "length(action) > 0",
            name=op.f("ck_auth_audit_logs_action_nonempty"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_audit_logs")),
        schema="auth",
    )
    op.create_index(
        "ix_auth_audit_logs_actor_id",
        "auth_audit_logs",
        ["actor_id"],
        unique=False,
        schema="auth",
    )
    op.create_index(
        "ix_auth_audit_logs_created_at",
        "auth_audit_logs",
        ["created_at"],
        unique=False,
        schema="auth",
    )
    op.create_table(
        "auth_permissions",
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("group_code", sa.Text(), nullable=False),
        sa.Column("group_label", sa.Text(), nullable=False),
        sa.Column(
            "sort_order",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column(
            "is_builtin",
            sa.Boolean(),
            server_default=sa.text("false"),
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
        sa.CheckConstraint(
            "kind IN ('view', 'manage', 'operate', 'admin')",
            name=op.f("ck_auth_permissions_kind_valid"),
        ),
        sa.CheckConstraint(
            "length(code) > 0", name=op.f("ck_auth_permissions_code_nonempty")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_permissions")),
        sa.UniqueConstraint("code", name="uq_auth_permissions_code"),
        schema="auth",
    )
    op.create_table(
        "auth_roles",
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "is_builtin",
            sa.Boolean(),
            server_default=sa.text("false"),
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
        sa.CheckConstraint(
            "length(name) > 0", name=op.f("ck_auth_roles_name_nonempty")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_roles")),
        sa.UniqueConstraint("name", name="uq_auth_roles_name"),
        schema="auth",
    )
    op.create_table(
        "auth_route_rules",
        sa.Column("path_pattern", sa.Text(), nullable=False),
        sa.Column("http_method", sa.Text(), nullable=False),
        sa.Column(
            "permission_codes",
            sa.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column(
            "match_mode",
            sa.Text(),
            server_default=sa.text("'all'"),
            nullable=False,
        ),
        sa.Column(
            "priority",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "is_enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "is_builtin",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("description", sa.Text(), nullable=True),
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
        sa.CheckConstraint(
            "http_method IN ('GET','POST','PUT','PATCH','DELETE',"
            "'HEAD','OPTIONS','*')",
            name=op.f("ck_auth_route_rules_http_method_valid"),
        ),
        sa.CheckConstraint(
            "match_mode IN ('all', 'any')",
            name=op.f("ck_auth_route_rules_match_mode_valid"),
        ),
        sa.CheckConstraint(
            "length(path_pattern) > 0",
            name=op.f("ck_auth_route_rules_path_pattern_nonempty"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_route_rules")),
        sa.UniqueConstraint(
            "path_pattern",
            "http_method",
            name="uq_auth_route_rules_path_pattern_http_method",
        ),
        schema="auth",
    )
    op.create_index(
        "ix_auth_route_rules_priority",
        "auth_route_rules",
        [sa.literal_column("priority DESC")],
        unique=False,
        schema="auth",
        postgresql_where=sa.text("is_enabled"),
    )
    op.create_table(
        "auth_role_permissions",
        sa.Column("role_id", sa.UUID(), nullable=False),
        sa.Column("permission_id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["permission_id"],
            ["auth.auth_permissions.id"],
            name=op.f("fk_auth_role_permissions_permission_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["role_id"],
            ["auth.auth_roles.id"],
            name=op.f("fk_auth_role_permissions_role_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "role_id", "permission_id", name=op.f("pk_auth_role_permissions")
        ),
        schema="auth",
    )
    op.create_table(
        "auth_users",
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("hashed_password", sa.Text(), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("phone", sa.Text(), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("role_id", sa.UUID(), nullable=False),
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
        sa.CheckConstraint(
            "position('@' in email) > 1", name=op.f("ck_auth_users_email_shape")
        ),
        sa.CheckConstraint(
            "length(username) > 0", name=op.f("ck_auth_users_username_nonempty")
        ),
        sa.ForeignKeyConstraint(
            ["role_id"],
            ["auth.auth_roles.id"],
            name=op.f("fk_auth_users_role_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_users")),
        schema="auth",
    )
    op.create_index(
        "ix_auth_users_role_id",
        "auth_users",
        ["role_id"],
        unique=False,
        schema="auth",
    )
    op.create_index(
        "uq_auth_users_email_lower",
        "auth_users",
        [sa.literal_column("lower(email)")],
        unique=True,
        schema="auth",
    )
    op.create_index(
        "uq_auth_users_username_lower",
        "auth_users",
        [sa.literal_column("lower(username)")],
        unique=True,
        schema="auth",
    )
    op.create_table(
        "auth_user_permissions",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("permission_id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["permission_id"],
            ["auth.auth_permissions.id"],
            name=op.f("fk_auth_user_permissions_permission_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["auth.auth_users.id"],
            name=op.f("fk_auth_user_permissions_user_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "user_id", "permission_id", name=op.f("pk_auth_user_permissions")
        ),
        schema="auth",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("auth_user_permissions", schema="auth")
    op.drop_index(
        "uq_auth_users_username_lower", table_name="auth_users", schema="auth"
    )
    op.drop_index(
        "uq_auth_users_email_lower", table_name="auth_users", schema="auth"
    )
    op.drop_index(
        "ix_auth_users_role_id", table_name="auth_users", schema="auth"
    )
    op.drop_table("auth_users", schema="auth")
    op.drop_table("auth_role_permissions", schema="auth")
    op.drop_index(
        "ix_auth_route_rules_priority",
        table_name="auth_route_rules",
        schema="auth",
        postgresql_where=sa.text("is_enabled"),
    )
    op.drop_table("auth_route_rules", schema="auth")
    op.drop_table("auth_roles", schema="auth")
    op.drop_table("auth_permissions", schema="auth")
    op.drop_index(
        "ix_auth_audit_logs_created_at",
        table_name="auth_audit_logs",
        schema="auth",
    )
    op.drop_index(
        "ix_auth_audit_logs_actor_id",
        table_name="auth_audit_logs",
        schema="auth",
    )
    op.drop_table("auth_audit_logs", schema="auth")
