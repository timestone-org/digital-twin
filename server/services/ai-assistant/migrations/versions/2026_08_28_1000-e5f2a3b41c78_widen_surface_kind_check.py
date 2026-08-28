"""chat_sessions 的 surface_kind 闭合集合加一档：twin2d-editor。

纯扩展步：换成更宽的那条 CHECK，无回填。「新结构 + 旧代码」照常可用——
旧代码只是永远不写这一档。

Revision ID: e5f2a3b41c78
Revises: d4a1c7b2e903
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e5f2a3b41c78"
down_revision: str | None = "d4a1c7b2e903"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "assistant"
TABLE = "chat_sessions"
CONSTRAINT = "ck_chat_sessions_surface_kind_known"

NARROW = (
    "'dashboard-editor', 'twin-editor', 'dataset-table', "
    "'collect-source', 'dashboard-view'"
)
WIDE = (
    "'dashboard-editor', 'twin-editor', 'twin2d-editor', 'dataset-table', "
    "'collect-source', 'dashboard-view'"
)


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _swap(WIDE)


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    # ⚠ 已经落在 twin2d-editor 上的会话行会让 VALIDATE 直接失败。不悄悄删掉
    # 它们是有意的：回退结构可以，丢用户的会话不行——先把那些行处理掉再退
    _swap(NARROW)


def _swap(kinds: str) -> None:
    """换掉那条 CHECK：删旧的、按 NOT VALID 加新的、再单独 VALIDATE。

    ⚠ 一步 ADD CONSTRAINT 会持排他锁全表扫；NOT VALID 立刻返回，
    VALIDATE 只要 SHARE UPDATE EXCLUSIVE，热表上不挡读写。

    Args: kinds（闭合集合摊成的值列表）。
    """
    op.execute(f"ALTER TABLE {SCHEMA}.{TABLE} DROP CONSTRAINT {CONSTRAINT}")
    op.execute(
        f"ALTER TABLE {SCHEMA}.{TABLE} ADD CONSTRAINT {CONSTRAINT} "
        f"CHECK (surface_kind IN ({kinds})) NOT VALID"
    )
    op.execute(f"ALTER TABLE {SCHEMA}.{TABLE} VALIDATE CONSTRAINT {CONSTRAINT}")
