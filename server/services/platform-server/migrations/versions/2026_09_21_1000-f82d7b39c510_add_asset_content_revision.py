"""素材内容版本指针；空值兼容已有对象键。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f82d7b39c510"
down_revision: str | None = "e71c6a28b409"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    for name in ("content_revision", "content_upload_id"):
        op.add_column(
            "assets",
            sa.Column(name, postgresql.UUID(as_uuid=True), nullable=True),
            schema="platform",
        )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.drop_column("assets", "content_upload_id", schema="platform")
    op.drop_column("assets", "content_revision", schema="platform")
