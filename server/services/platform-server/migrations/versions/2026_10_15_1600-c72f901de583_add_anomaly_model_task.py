"""允许无目标列的异常检测模型，存量监督模型保持原约束。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c72f901de583"
down_revision: str | None = "bf93a67e2104"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MODEL_TASKS = "'anomaly_detection', 'classification', 'regression'"
TABLE = "platform.modeling_model_versions"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.execute(
        "ALTER TABLE platform.modeling_model_versions "
        "DROP CONSTRAINT ck_modeling_model_versions_task_known"
    )
    op.execute(
        f"ALTER TABLE {TABLE} ADD CONSTRAINT "
        "ck_modeling_model_versions_task_known "
        f"CHECK (task IN ({MODEL_TASKS})) NOT VALID"
    )
    op.execute(
        f"ALTER TABLE {TABLE} ADD CONSTRAINT "
        "ck_modeling_model_versions_target_matches_task CHECK "
        "((task = 'anomaly_detection' AND target_key IS NULL) OR "
        "(task <> 'anomaly_detection' AND target_key IS NOT NULL)) NOT VALID"
    )
    op.execute(
        f"ALTER TABLE {TABLE} "
        "VALIDATE CONSTRAINT ck_modeling_model_versions_task_known"
    )
    op.execute(
        f"ALTER TABLE {TABLE} "
        "VALIDATE CONSTRAINT ck_modeling_model_versions_target_matches_task"
    )
    op.alter_column(
        "modeling_model_versions",
        "target_key",
        nullable=True,
        schema="platform",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    found = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT 1 FROM platform.modeling_model_versions "
                "WHERE task = 'anomaly_detection' LIMIT 1"
            )
        )
        .scalar()
    )
    if found is not None:
        raise RuntimeError("已有异常检测模型，不能收缩为仅支持监督模型的结构")
    op.alter_column(
        "modeling_model_versions",
        "target_key",
        nullable=False,
        schema="platform",
    )
    op.execute(
        f"ALTER TABLE {TABLE} "
        "DROP CONSTRAINT ck_modeling_model_versions_target_matches_task"
    )
    op.execute(
        f"ALTER TABLE {TABLE} "
        "DROP CONSTRAINT ck_modeling_model_versions_task_known"
    )
    op.execute(
        f"ALTER TABLE {TABLE} "
        "ADD CONSTRAINT ck_modeling_model_versions_task_known "
        "CHECK (task IN ('classification', 'regression')) NOT VALID"
    )
    op.execute(
        f"ALTER TABLE {TABLE} "
        "VALIDATE CONSTRAINT ck_modeling_model_versions_task_known"
    )
