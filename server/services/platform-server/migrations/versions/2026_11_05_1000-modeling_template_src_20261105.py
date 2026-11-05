"""允许模板独立于来源工作流；先发布兼容读者再解除来源，不回填数据。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "modeling_template_src_20261105"
down_revision: str | None = "modeling_workflow_idx_20261103"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.alter_column(
        "modeling_templates",
        "pipeline_id",
        existing_type=postgresql.UUID(),
        nullable=True,
        schema="platform",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    if op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM platform.modeling_templates "
            "WHERE pipeline_id IS NULL)"
        )
    ):
        raise RuntimeError("已有独立模板，数据库不可收缩；请保留兼容读者")
    name = "ck_modeling_templates_source_not_null"
    op.execute(
        f"ALTER TABLE platform.modeling_templates ADD CONSTRAINT {name} "
        "CHECK (pipeline_id IS NOT NULL) NOT VALID"
    )
    op.execute(
        f"ALTER TABLE platform.modeling_templates VALIDATE CONSTRAINT {name}"
    )
    op.alter_column(
        "modeling_templates",
        "pipeline_id",
        existing_type=postgresql.UUID(),
        nullable=False,
        schema="platform",
    )
    op.drop_constraint(
        name, "modeling_templates", schema="platform", type_="check"
    )
