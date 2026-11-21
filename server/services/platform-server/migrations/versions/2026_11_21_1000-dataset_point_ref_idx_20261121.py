"""给按点位反查台账列的查询补并发索引。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dataset_point_ref_idx_20261121"
down_revision: str | None = "modeling_template_src_20261105"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEX_NAME = "ix_dataset_columns_point_node_key"

# UUID 前缀走既有可解析形状，保留第一个冒号之后的完整点位编码
IDENTITY_SQL = """
CREATE OR REPLACE FUNCTION platform.dataset_point_identity(stored_key text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT
AS $identity$
    SELECT CASE
        WHEN separator > 0 AND separator < length(stored_key)
          AND length(source_text) = 32
          AND source_text ~
              '^[[:space:]]*[+]?[0-9a-f](_?[0-9a-f])*[[:space:]]*$'
        THEN lpad(
            regexp_replace(source_text, '[[:space:]_+]', '', 'g'), 32, '0'
        )
            ::uuid::text || substr(stored_key, separator)
    END
    FROM (
        SELECT strpos(stored_key, ':') AS separator,
               lower(replace(
                   btrim(split_part(stored_key, ':', 1), '{}'), '-', ''
               )) AS source_text
    ) AS parsed
$identity$
"""


def _drop_index() -> None:
    op.drop_index(
        INDEX_NAME,
        table_name="dataset_columns",
        schema="platform",
        if_exists=True,
        postgresql_concurrently=True,
    )


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.execute(IDENTITY_SQL)
    with op.get_context().autocommit_block():
        # ⚠ 并发建索引失败可能留下无效索引，续跑时先移除
        _drop_index()
        op.create_index(
            INDEX_NAME,
            "dataset_columns",
            [sa.text("platform.dataset_point_identity(node_key)")],
            schema="platform",
            postgresql_concurrently=True,
            postgresql_where=sa.text("node_key IS NOT NULL"),
        )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    with op.get_context().autocommit_block():
        _drop_index()
    op.execute("DROP FUNCTION IF EXISTS platform.dataset_point_identity(text)")
