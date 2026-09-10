"""扩展步：给摄取任务加 generation 栅栏（ADR-0054）。

长时间的 DOCX 预览派生让「旧消息确认失败后，用户又点了重新解析」更容易撞上。
generation 把文档当前期次与队列消息对齐，旧期次只能被确认，不能覆盖新期次。

Revision ID: b8f2c6d41e90
Revises: a7e1b4c96d38
"""

from collections.abc import Sequence

from alembic import op

from knowledge_server.settings import DB_SCHEMA

revision: str = "b8f2c6d41e90"
down_revision: str | None = "a7e1b4c96d38"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = DB_SCHEMA
DOCUMENTS = "kb_documents"


def upgrade() -> None:
    """加可空 generation；存量行由下一次显式重排自然写入。"""
    op.execute("SET lock_timeout = '5s'")
    op.execute(
        f'ALTER TABLE "{SCHEMA}"."{DOCUMENTS}" '
        "ADD COLUMN ingest_generation uuid NULL"
    )


def downgrade() -> None:
    """移除 generation 栅栏。"""
    op.execute("SET lock_timeout = '5s'")
    op.execute(
        f'ALTER TABLE "{SCHEMA}"."{DOCUMENTS}" '
        "DROP COLUMN IF EXISTS ingest_generation"
    )
