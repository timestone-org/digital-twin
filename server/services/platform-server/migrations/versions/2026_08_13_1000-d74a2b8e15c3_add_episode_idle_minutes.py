"""事件表加全停时长 `idle_minutes`（蓄热特征，docs/AC_MODEL_DESIGN.md §2.5）。

加列可空，纯扩展步。⚠ NULL 表示「LOGIC_VERSION < 2 抽的行」，不表示零：
特征层把 NULL 当 NaN，不擅自编值。约束按扩展步加成 `NOT VALID` 再 `VALIDATE`
——存量行该列全 NULL，校验瞬时完成，但口径不因此破例。

Revision ID: d74a2b8e15c3
Revises: c63d4f2a80e1
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d74a2b8e15c3"
down_revision: str | None = "c63d4f2a80e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "hvac_ac_startup_episodes"
_CHECK = "ck_hvac_ac_startup_episodes_idle_nonnegative"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.add_column(
        _TABLE,
        sa.Column("idle_minutes", sa.Integer(), nullable=True),
        schema="platform",
    )
    op.execute(
        f"ALTER TABLE platform.{_TABLE} ADD CONSTRAINT {_CHECK} "
        "CHECK (idle_minutes IS NULL OR idle_minutes >= 0) NOT VALID"
    )
    op.execute(f"ALTER TABLE platform.{_TABLE} VALIDATE CONSTRAINT {_CHECK}")


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.drop_constraint(_CHECK, _TABLE, schema="platform")
    op.drop_column(_TABLE, "idle_minutes", schema="platform")
