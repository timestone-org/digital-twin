"""建点位历史宽表并把它变成压缩超表。

列契约在 `domain/timeseries`，分块与压缩的实测取值见 docs/COLLECT_DESIGN.md §6。

Revision ID: 9b7d4e2a61c8
Revises: 4c1e8a92b7d3
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9b7d4e2a61c8"
down_revision: str | None = "4c1e8a92b7d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "point_history"
QUALIFIED = f"collect.{TABLE}"
# ⚠ 质量位在这里是**写死的字面量**，不许改成 import `timeseries.QUALITIES`：
# 迁移是冻结件，而那是个活常量——将来给 Quality 加第四档，同一个 revision
# 在旧库建出三档、在新建库建出四档，且没有任何东西会报错。
# 两侧不许漂由 tests/contract/test_history_ddl_literals.py 盯着
QUALITY_LITERALS = ("good", "uncertain", "bad")
_QUALITY_LITERALS = ", ".join(f"'{quality}'" for quality in QUALITY_LITERALS)

# ⚠ 6 小时而不是 1 天：1 天的块实测 4109 MB 堆 + 约 9100 MB 索引，超内存预算
# 4.59×；6 小时同时给出最好的压缩比（10.28×）。前提是宿主机 ≥16 GB 内存
CHUNK_INTERVAL = "6 hours"
# ⚠ 段键**永远不要拿掉 point_code**：带着它压缩比 21.56×，且按点位删除退化
# 成丢弃整段、零解压（20.5ms）；拿掉它每次按点位删除都要解压整段
SEGMENT_BY = "source_id, point_code"
ORDER_BY = "ts DESC"
# 热区：比它更老的块自动压缩。压缩块上的 DML 代价高，热区必须盖住迟到数据
COMPRESS_AFTER = "7 days"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    # ⚠ 超表的全部能力都来自这个扩展。装不上就该在这里响亮失败，而不是退化
    # 成一张普通大表——那种退化要等到表涨到几亿行才会被发现
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
    op.create_table(
        TABLE,
        sa.Column("source_id", sa.UUID(), nullable=False),
        # 点位的**身份**，不是协议寻址串（COLLECT_DESIGN.md §2）
        sa.Column("point_code", sa.Text(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        # 测量值走 double precision；精确小数不在这张表里
        sa.Column("value_num", sa.Double(), nullable=True),
        # 非数值量的 JSON 编码，与 value_num 互斥（timeseries.split_value）
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column(
            "quality",
            sa.Text(),
            server_default=sa.text("'good'"),
            nullable=False,
        ),
        sa.CheckConstraint(
            f"quality IN ({_QUALITY_LITERALS})",
            name=op.f("ck_point_history_quality"),
        ),
        # ⚠ 自然复合键而不是 UUID 代理键：Timescale 要求分区列进每个唯一约束，
        # 而这个键一物三用——幂等去重 / 主查询索引 / 分区约束。没有它，
        # 「20 个点位取最近 300 点」实测 63042ms，有它 0.62ms
        sa.PrimaryKeyConstraint(
            "source_id", "point_code", "ts", name=op.f("pk_point_history")
        ),
        # 无外键指向 platform 的数据源表：历史必须能在数据源删掉之后存活，
        # 且超表上的外键会拖慢每一次写入
        schema="collect",
    )
    op.execute(
        f"SELECT create_hypertable('{QUALIFIED}', 'ts', "
        f"chunk_time_interval => interval '{CHUNK_INTERVAL}', "
        "create_default_indexes => FALSE)"
    )
    op.execute(
        f"ALTER TABLE {QUALIFIED} SET ("
        "timescaledb.compress, "
        f"timescaledb.compress_segmentby = '{SEGMENT_BY}', "
        f"timescaledb.compress_orderby = '{ORDER_BY}')"
    )
    op.execute(
        f"SELECT add_compression_policy('{QUALIFIED}', "
        f"INTERVAL '{COMPRESS_AFTER}', if_not_exists => TRUE)"
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    # 先撤策略再删表：留着的后台作业会指向一张不存在的超表
    op.execute(
        f"SELECT remove_compression_policy('{QUALIFIED}', if_exists => TRUE)"
    )
    op.drop_table(TABLE, schema="collect")
    # ⚠ 扩展不删：同一个库里可能有别人的超表，删它是跨属主的破坏性操作
