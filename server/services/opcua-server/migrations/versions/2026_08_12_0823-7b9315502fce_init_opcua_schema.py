"""建 opcua schema 的初始结构：实例、地址空间节点、自定义类型、凭据、信任证书。

schema 由 env.py 在迁移前 CREATE IF NOT EXISTS。

⚠ 节点的当前值不在这里——权威源是进程内存，重启回初值（CONTEXT.md 不变式 1、2）。
`initial_value` 是配置意义上的初值，不是运行态。

Revision ID: 7b9315502fce
Revises:
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "7b9315502fce"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        "opcua_instances",
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "endpoint_path",
            sa.Text(),
            server_default=sa.text("'/'"),
            nullable=False,
        ),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("namespace_uri", sa.Text(), nullable=False),
        sa.Column("security_policies", sa.ARRAY(sa.Text()), nullable=False),
        sa.Column(
            "is_anonymous_allowed",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "desired_state",
            sa.Text(),
            server_default=sa.text("'stopped'"),
            nullable=False,
        ),
        sa.Column(
            "has_pending_restart",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "is_autostart",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("certificate_fingerprint", sa.Text(), nullable=True),
        sa.Column("certificate_subject", sa.Text(), nullable=True),
        sa.Column(
            "certificate_expires_at", sa.DateTime(timezone=True), nullable=True
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
            "desired_state IN ('running', 'stopped')",
            name=op.f("ck_opcua_instances_desired_state_valid"),
        ),
        sa.CheckConstraint(
            "endpoint_path LIKE '/%'",
            name=op.f("ck_opcua_instances_endpoint_path_absolute"),
        ),
        sa.CheckConstraint(
            "security_policies <@ ARRAY['NoSecurity', "
            "'Basic256Sha256_Sign', 'Basic256Sha256_SignAndEncrypt', "
            "'Aes128Sha256RsaOaep_Sign', "
            "'Aes128Sha256RsaOaep_SignAndEncrypt', "
            "'Aes256Sha256RsaPss_Sign', "
            "'Aes256Sha256RsaPss_SignAndEncrypt']::text[]",
            name=op.f("ck_opcua_instances_security_policies_known"),
        ),
        sa.CheckConstraint(
            "cardinality(security_policies) > 0",
            name=op.f("ck_opcua_instances_security_policies_nonempty"),
        ),
        sa.CheckConstraint(
            "length(name) > 0", name=op.f("ck_opcua_instances_name_nonempty")
        ),
        sa.CheckConstraint(
            "length(namespace_uri) > 0",
            name=op.f("ck_opcua_instances_namespace_uri_nonempty"),
        ),
        sa.CheckConstraint(
            "port BETWEEN 1 AND 65535",
            name=op.f("ck_opcua_instances_port_in_range"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_opcua_instances")),
        sa.UniqueConstraint("name", name="uq_opcua_instances_name"),
        sa.UniqueConstraint("port", name="uq_opcua_instances_port"),
        schema="opcua",
    )
    op.create_table(
        "opcua_instance_credentials",
        sa.Column("instance_id", sa.UUID(), nullable=False),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("hashed_password", sa.Text(), nullable=False),
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
            "length(hashed_password) > 0",
            name=op.f("ck_opcua_instance_credentials_hashed_password_nonempty"),
        ),
        sa.CheckConstraint(
            "length(username) > 0",
            name=op.f("ck_opcua_instance_credentials_username_nonempty"),
        ),
        sa.ForeignKeyConstraint(
            ["instance_id"],
            ["opcua.opcua_instances.id"],
            name=op.f("fk_opcua_instance_credentials_instance_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "id", name=op.f("pk_opcua_instance_credentials")
        ),
        sa.UniqueConstraint(
            "instance_id",
            "username",
            name="uq_opcua_instance_credentials_instance_id_username",
        ),
        schema="opcua",
    )
    op.create_index(
        "ix_opcua_instance_credentials_instance_id",
        "opcua_instance_credentials",
        ["instance_id"],
        unique=False,
        schema="opcua",
    )
    op.create_table(
        "opcua_instance_trusted_certs",
        sa.Column("instance_id", sa.UUID(), nullable=False),
        sa.Column("fingerprint", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("public_key_pem", sa.Text(), nullable=True),
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
            "public_key_pem IS NULL OR public_key_pem NOT LIKE '%PRIVATE KEY%'",
            name=op.f("ck_opcua_instance_trusted_certs_no_private_key"),
        ),
        sa.CheckConstraint(
            "length(fingerprint) > 0",
            name=op.f("ck_opcua_instance_trusted_certs_fingerprint_nonempty"),
        ),
        sa.CheckConstraint(
            "length(subject) > 0",
            name=op.f("ck_opcua_instance_trusted_certs_subject_nonempty"),
        ),
        sa.ForeignKeyConstraint(
            ["instance_id"],
            ["opcua.opcua_instances.id"],
            name=op.f("fk_opcua_instance_trusted_certs_instance_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "id", name=op.f("pk_opcua_instance_trusted_certs")
        ),
        sa.UniqueConstraint(
            "instance_id",
            "fingerprint",
            name="uq_opcua_instance_trusted_certs_instance_id_fingerprint",
        ),
        schema="opcua",
    )
    op.create_index(
        "ix_opcua_instance_trusted_certs_instance_id",
        "opcua_instance_trusted_certs",
        ["instance_id"],
        unique=False,
        schema="opcua",
    )
    op.create_table(
        "opcua_nodes",
        sa.Column("instance_id", sa.UUID(), nullable=False),
        sa.Column("parent_id", sa.UUID(), nullable=True),
        sa.Column("browse_name", sa.Text(), nullable=False),
        sa.Column("node_class", sa.Text(), nullable=False),
        sa.Column("identifier", sa.Text(), nullable=False),
        sa.Column(
            "identifier_kind",
            sa.Text(),
            server_default=sa.text("'string'"),
            nullable=False,
        ),
        sa.Column("data_type", sa.Text(), nullable=True),
        sa.Column(
            "value_rank",
            sa.Integer(),
            server_default=sa.text("-1"),
            nullable=False,
        ),
        sa.Column("array_dimensions", sa.ARRAY(sa.Integer()), nullable=True),
        sa.Column(
            "access_level",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column(
            "initial_value",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
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
            "data_type IS NULL OR data_type IN ('boolean', 'sbyte', "
            "'byte', 'int16', 'uint16', 'int32', 'uint32', 'int64', "
            "'uint64', 'float', 'double', 'string', 'datetime', "
            "'guid', 'byte_string')",
            name=op.f("ck_opcua_nodes_data_type_valid"),
        ),
        sa.CheckConstraint(
            "identifier_kind <> 'numeric' OR identifier ~ '^[0-9]+$'",
            name=op.f("ck_opcua_nodes_numeric_identifier_is_digits"),
        ),
        sa.CheckConstraint(
            "identifier_kind IN ('numeric', 'string')",
            name=op.f("ck_opcua_nodes_identifier_kind_valid"),
        ),
        sa.CheckConstraint(
            "node_class IN ('object', 'variable', 'property', 'method')",
            name=op.f("ck_opcua_nodes_node_class_valid"),
        ),
        sa.CheckConstraint(
            "access_level BETWEEN 0 AND 255",
            name=op.f("ck_opcua_nodes_access_level_in_range"),
        ),
        sa.CheckConstraint(
            "length(browse_name) > 0",
            name=op.f("ck_opcua_nodes_browse_name_nonempty"),
        ),
        sa.CheckConstraint(
            "length(identifier) > 0",
            name=op.f("ck_opcua_nodes_identifier_nonempty"),
        ),
        sa.CheckConstraint(
            "parent_id IS NULL OR parent_id <> id",
            name=op.f("ck_opcua_nodes_no_self_parent"),
        ),
        sa.CheckConstraint(
            "value_rank >= -3", name=op.f("ck_opcua_nodes_value_rank_in_range")
        ),
        sa.ForeignKeyConstraint(
            ["instance_id"],
            ["opcua.opcua_instances.id"],
            name=op.f("fk_opcua_nodes_instance_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["opcua.opcua_nodes.id"],
            name=op.f("fk_opcua_nodes_parent_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_opcua_nodes")),
        sa.UniqueConstraint(
            "instance_id",
            "identifier",
            name="uq_opcua_nodes_instance_id_identifier",
        ),
        schema="opcua",
    )
    op.create_index(
        "ix_opcua_nodes_instance_id",
        "opcua_nodes",
        ["instance_id"],
        unique=False,
        schema="opcua",
    )
    op.create_index(
        "ix_opcua_nodes_parent_id",
        "opcua_nodes",
        ["parent_id"],
        unique=False,
        schema="opcua",
    )
    op.create_table(
        "opcua_types",
        sa.Column("instance_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("browse_name", sa.Text(), nullable=False),
        sa.Column("identifier", sa.Text(), nullable=False),
        sa.Column(
            "identifier_kind",
            sa.Text(),
            server_default=sa.text("'string'"),
            nullable=False,
        ),
        sa.Column("super_type_identifier", sa.Text(), nullable=True),
        sa.Column(
            "definition",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
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
            "identifier_kind <> 'numeric' OR identifier ~ '^[0-9]+$'",
            name=op.f("ck_opcua_types_numeric_identifier_is_digits"),
        ),
        sa.CheckConstraint(
            "identifier_kind IN ('numeric', 'string')",
            name=op.f("ck_opcua_types_identifier_kind_valid"),
        ),
        sa.CheckConstraint(
            "kind IN ('object_type', 'variable_type', 'data_type')",
            name=op.f("ck_opcua_types_kind_valid"),
        ),
        sa.CheckConstraint(
            "length(browse_name) > 0",
            name=op.f("ck_opcua_types_browse_name_nonempty"),
        ),
        sa.CheckConstraint(
            "length(identifier) > 0",
            name=op.f("ck_opcua_types_identifier_nonempty"),
        ),
        sa.ForeignKeyConstraint(
            ["instance_id"],
            ["opcua.opcua_instances.id"],
            name=op.f("fk_opcua_types_instance_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_opcua_types")),
        sa.UniqueConstraint(
            "instance_id",
            "identifier",
            name="uq_opcua_types_instance_id_identifier",
        ),
        schema="opcua",
    )
    op.create_index(
        "ix_opcua_types_instance_id",
        "opcua_types",
        ["instance_id"],
        unique=False,
        schema="opcua",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_index(
        "ix_opcua_types_instance_id", table_name="opcua_types", schema="opcua"
    )
    op.drop_table("opcua_types", schema="opcua")
    op.drop_index(
        "ix_opcua_nodes_parent_id", table_name="opcua_nodes", schema="opcua"
    )
    op.drop_index(
        "ix_opcua_nodes_instance_id", table_name="opcua_nodes", schema="opcua"
    )
    op.drop_table("opcua_nodes", schema="opcua")
    op.drop_index(
        "ix_opcua_instance_trusted_certs_instance_id",
        table_name="opcua_instance_trusted_certs",
        schema="opcua",
    )
    op.drop_table("opcua_instance_trusted_certs", schema="opcua")
    op.drop_index(
        "ix_opcua_instance_credentials_instance_id",
        table_name="opcua_instance_credentials",
        schema="opcua",
    )
    op.drop_table("opcua_instance_credentials", schema="opcua")
    op.drop_table("opcua_instances", schema="opcua")
