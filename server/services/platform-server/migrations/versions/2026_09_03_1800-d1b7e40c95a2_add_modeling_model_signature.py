"""模型版本加一列「模型签名」：面向人与第三方系统的输入输出说明
（docs/MODELING_PLATFORM_DESIGN.md D6）。

纯扩展步：一列，带默认值 `{}`，没有回填。旧代码不读也不写它，
故「新结构 + 旧代码」可用。

⚠ 列名不叫 `schema_json`：出参模型上那个字段名会与 `BaseModel.schema` 撞，
pydantic 当场告警，而本仓 CI 是零告警。签名与 schema 是同一件东西的两个叫法，
库、出参、文档统一用签名。

Revision ID: d1b7e40c95a2
Revises: c9a3f61b0d24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d1b7e40c95a2"
down_revision: str | None = "c9a3f61b0d24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_TABLE = "modeling_model_versions"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        _TABLE,
        sa.Column(
            "signature_json",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    """⚠ 撤回只丢掉说明，不影响任何一个版本算数——推理只读可服务表示。"""
    op.execute("SET lock_timeout = '3s'")
    op.drop_column(_TABLE, "signature_json", schema=_SCHEMA)
