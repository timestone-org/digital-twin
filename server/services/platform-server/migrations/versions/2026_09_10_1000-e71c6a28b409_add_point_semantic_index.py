"""扩展点位描述与异步语义索引；不回填存量点位。"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e71c6a28b409"
down_revision: str | None = "d6a92e71b403"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        "collect_points",
        sa.Column("description", sa.Text(), nullable=True),
        schema="platform",
    )
    op.create_table(
        "collect_point_embeddings",
        sa.Column("point_id", sa.Uuid(), nullable=False),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column("model_signature", sa.Text(), nullable=False),
        sa.Column("embedding", postgresql.ARRAY(sa.Double()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("point_id", name="pk_collect_point_embeddings"),
        schema="platform",
    )
    op.execute(
        "ALTER TABLE platform.collect_point_embeddings "
        "ADD CONSTRAINT fk_collect_point_embeddings_point_id "
        "FOREIGN KEY (point_id) REFERENCES platform.collect_points(id) "
        "ON DELETE CASCADE NOT VALID"
    )
    op.execute(
        "ALTER TABLE platform.collect_point_embeddings VALIDATE CONSTRAINT "
        "fk_collect_point_embeddings_point_id"
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.drop_table("collect_point_embeddings", schema="platform")
    op.drop_column("collect_points", "description", schema="platform")
