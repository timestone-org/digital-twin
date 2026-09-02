"""凭据按**哪一路供应商**认行，而不是按「哪一种」（ADR-0040）。

目录里能配出好几路要登录的供应商，各自一份登录态，故加一列 `provider_ref`
存那一路的 id，并把 `provider` 上的唯一约束放掉——它现在存的是种类，几路
共用同一个值。

纯扩展步：新列可空、不回填。环境变量配出来的那一路（以及升级前存量那一行）
`provider_ref` 是空的，读侧按 `coalesce(provider_ref, provider)` 认，于是
**升级之后不用重新登录**；旧代码只认 `provider`，它那一行照旧读得到。

⚠ 唯一约束**不走 `CONCURRENTLY`**：那是给有活写入的存量大表用的，而这张表一路
订阅账号一行、整套部署也就几行，加约束那一下是毫秒级；开头那句 `lock_timeout`
兜着最坏情况。何况 `autocommit_block()` 在本仓的 alembic 配置下直接 assert 失败
（迁移压根跑不起来）。

Revision ID: c8f2b41d7e35
Revises: b3e7a1c92d48
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8f2b41d7e35"
down_revision: str | None = "b3e7a1c92d48"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "assistant"
TABLE = "model_credentials"
UNIQUE = "uq_model_credentials_provider_ref"
OLD_UNIQUE = "uq_model_credentials_provider"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        TABLE,
        sa.Column("provider_ref", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    # ⚠ 一路供应商只许有一行：两行的话，读到哪一行取决于排序，
    # 而「换了账号却没生效」是这一类故障里最难查的。
    # 空值互不相撞，故环境变量那一路那几行不受它管
    op.create_unique_constraint(UNIQUE, TABLE, ["provider_ref"], schema=SCHEMA)
    # ⚠ 放掉旧的唯一约束：`provider` 现在存的是种类，几路订阅账号共用
    # 同一个值。留着它的话，第二路登录时撞的是一条看不懂的唯一冲突
    op.drop_constraint(OLD_UNIQUE, TABLE, type_="unique", schema=SCHEMA)


def downgrade() -> None:
    """⚠ 收回唯一约束之前要确认只剩一行订阅凭据：配了两路的话，
    这一步当场失败——而那正是该失败的地方，不该替调用方删掉一份登录态。"""
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_unique_constraint(OLD_UNIQUE, TABLE, ["provider"], schema=SCHEMA)
    op.drop_constraint(UNIQUE, TABLE, type_="unique", schema=SCHEMA)
    op.drop_column(TABLE, "provider_ref", schema=SCHEMA)
