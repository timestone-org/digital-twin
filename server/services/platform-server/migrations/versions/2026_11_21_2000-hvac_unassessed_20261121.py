"""扩展开机事件允许的结果，先兼容读取未评估事件。"""

from collections.abc import Sequence

from alembic import op

revision: str = "hvac_unassessed_20261121"
down_revision: str | None = "runtime_param_actor_20261121"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "platform.hvac_ac_startup_episodes"
_CURRENT = "ck_hvac_ac_startup_episodes_outcome_known"
_REPLACEMENT = "ck_hvac_ac_startup_episodes_outcome_next"
_OLD_VALUES = "'usable', 'set_changed', 'timeout', 'data_gap'"


def _replace_check(values: str) -> None:
    """先验证新约束，再替换旧约束。Args: values。"""
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.execute(
        f"ALTER TABLE {_TABLE} ADD CONSTRAINT {_REPLACEMENT} "
        f"CHECK (outcome IN ({values})) NOT VALID"
    )
    op.execute(f"ALTER TABLE {_TABLE} VALIDATE CONSTRAINT {_REPLACEMENT}")
    op.execute(f"ALTER TABLE {_TABLE} DROP CONSTRAINT {_CURRENT}")
    op.execute(
        f"ALTER TABLE {_TABLE} RENAME CONSTRAINT {_REPLACEMENT} TO {_CURRENT}"
    )


def upgrade() -> None:
    _replace_check(f"{_OLD_VALUES}, 'unassessed'")


def downgrade() -> None:
    _replace_check(_OLD_VALUES)
