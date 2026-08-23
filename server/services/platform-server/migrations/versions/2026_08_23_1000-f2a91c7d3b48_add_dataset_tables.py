"""建数据台账的三张表，其中台账行是压缩超表（docs/DATASET_DESIGN.md §4.2）。

三张都是新建表，索引随建表一起下，不需要 CONCURRENTLY，也没有回填。
公式库表 `dataset_formulas` 不在这一版：它随公式引擎一起落地（§5）。

Revision ID: f2a91c7d3b48
Revises: e1b7d4a9c206
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f2a91c7d3b48"
down_revision: str | None = "e1b7d4a9c206"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_RECORDS = "dataset_records"
_QUALIFIED_RECORDS = f"{_SCHEMA}.{_RECORDS}"

# ⚠ 五组取值在这里是**写死的字面量**，不许改成 import
# `apps/dataset/protocols.py`：迁移是冻结件，而那是个活常量——将来给某一组加一
# 档，同一个 revision 会在旧库建出旧集合、在新建库建出新集合，且没有任何东西
# 会报错。两侧不许漂由 tests/contract/test_dataset_ddl_literals.py 盯着。
COLLECT_MODES = "'aggregate', 'manual'"
COLUMN_SOURCES = "'formula', 'manual', 'point'"
COLUMN_TYPES = "'bool', 'number', 'string'"
AGG_FUNCS = "'avg', 'count', 'delta', 'first', 'last', 'max', 'min', 'sum'"
RECORD_SOURCES = "'collect', 'import', 'manual'"
# 与 models/table.py 的 MIN_INTERVAL_MS / MAX_INTERVAL_MS 同值
MIN_INTERVAL_MS = 1_000
MAX_INTERVAL_MS = 86_400_000
# 与 models/column.py 的 MAX_FORMULA_LENGTH / MAX_DECIMALS 同值
MAX_FORMULA_LENGTH = 2_000
MAX_DECIMALS = 10
# 与 models/column.py 的 KEY_PATTERN 同一条规则；SQL 字面量里的单引号
# 要写成两个
KEY_CHECK = "key ~ '^[^\\s@''\"(),.:{}\\[\\]]+$'"

# ⚠ 7 天而不是采集侧的 6 小时：台账是低频派生层，年增 10⁴~10⁶ 行，比点位历史
# 低 3~4 个数量级，照抄那边的参数会切出一堆几乎空着的块（§1.3）
CHUNK_INTERVAL = "7 days"
# ⚠ 段键取 table_id：逐表删除于是退化成丢弃整段、零解压
SEGMENT_BY = "table_id"
ORDER_BY = "ts DESC"
# 热区：比它更老的块自动压缩。压缩块上的 DML 代价高，热区必须盖住人工补录
COMPRESS_AFTER = "30 days"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    # ⚠ 平台侧自己装一次而不是指望采集侧先跑：两条迁移链互相独立，谁先跑取决
    # 于部署顺序。装不上就该在这里响亮失败，而不是退化成一张普通大表——那种
    # 退化要等到保留期清理退化成全表扫描才会被发现
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
    _create_tables()
    _create_columns()
    _create_records()


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    # 先撤策略再删表：留着的后台作业会指向一张不存在的超表
    op.execute(
        f"SELECT remove_compression_policy('{_QUALIFIED_RECORDS}', "
        "if_exists => TRUE)"
    )
    op.drop_table(_RECORDS, schema=_SCHEMA)
    op.drop_index(
        "ix_dataset_columns_table_id", "dataset_columns", schema=_SCHEMA
    )
    op.drop_table("dataset_columns", schema=_SCHEMA)
    op.drop_table("dataset_tables", schema=_SCHEMA)
    # ⚠ 扩展不删：同一个库里还有别人的超表，删它是跨属主的破坏性操作


def _timestamps() -> tuple[sa.Column[datetime], sa.Column[datetime]]:
    """两列建表时刻。时刻一律 timestamptz 存 UTC。"""
    return (
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def _create_tables() -> None:
    op.create_table(
        "dataset_tables",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "collect_mode",
            sa.Text(),
            server_default=sa.text("'manual'"),
            nullable=False,
        ),
        sa.Column(
            "collect_interval_ms",
            sa.Integer(),
            server_default=sa.text("60000"),
            nullable=False,
        ),
        sa.Column("retention_days", sa.Integer(), nullable=True),
        # 采集器水位：已算完的最后一个桶的起点
        sa.Column(
            "last_collected_ts", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "is_enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_dataset_tables"),
        # `code` 是大屏绑定键 `ds:{code}:{列key}` 的前半段，撞了就是两张台账
        # 共用身份
        sa.UniqueConstraint("code", name="uq_dataset_tables_code"),
        sa.CheckConstraint(
            f"collect_mode IN ({COLLECT_MODES})",
            name="ck_dataset_tables_collect_mode_known",
        ),
        sa.CheckConstraint(
            "length(name) > 0", name="ck_dataset_tables_name_nonempty"
        ),
        sa.CheckConstraint(
            "length(code) BETWEEN 1 AND 64",
            name="ck_dataset_tables_code_sized",
        ),
        sa.CheckConstraint(
            f"collect_interval_ms BETWEEN {MIN_INTERVAL_MS} "
            f"AND {MAX_INTERVAL_MS}",
            name="ck_dataset_tables_collect_interval_sane",
        ),
        sa.CheckConstraint(
            "retention_days IS NULL OR retention_days > 0",
            name="ck_dataset_tables_retention_positive",
        ),
        schema=_SCHEMA,
    )


def _create_columns() -> None:
    op.create_table(
        "dataset_columns",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("table_id", sa.UUID(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("unit", sa.Text(), nullable=True),
        sa.Column("decimals", sa.Integer(), nullable=True),
        sa.Column(
            "data_type",
            sa.Text(),
            server_default=sa.text("'number'"),
            nullable=False,
        ),
        sa.Column(
            "source",
            sa.Text(),
            server_default=sa.text("'manual'"),
            nullable=False,
        ),
        sa.Column(
            "agg", sa.Text(), server_default=sa.text("'avg'"), nullable=False
        ),
        # 点位**身份** `{source_id}:{point_code}`；不建外键，删点位不连坐历史
        sa.Column("node_key", sa.Text(), nullable=True),
        sa.Column("formula", sa.Text(), nullable=True),
        sa.Column("formula_deps", postgresql.JSONB(), nullable=True),
        sa.Column(
            "order_index",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "is_required",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("default_value", postgresql.JSONB(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_dataset_columns"),
        sa.ForeignKeyConstraint(
            ["table_id"],
            ["platform.dataset_tables.id"],
            name="fk_dataset_columns_table_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "table_id", "key", name="uq_dataset_columns_table_id_key"
        ),
        *_column_checks(),
        schema=_SCHEMA,
    )
    op.create_index(
        "ix_dataset_columns_table_id",
        "dataset_columns",
        ["table_id"],
        schema=_SCHEMA,
    )


def _column_checks() -> tuple[sa.CheckConstraint, ...]:
    """列定义的全部 CHECK。装成一组只为让建表那段不超过函数行数上限。"""
    return (
        sa.CheckConstraint(
            f"data_type IN ({COLUMN_TYPES})",
            name="ck_dataset_columns_data_type_known",
        ),
        sa.CheckConstraint(
            f"source IN ({COLUMN_SOURCES})",
            name="ck_dataset_columns_source_known",
        ),
        sa.CheckConstraint(
            f"agg IN ({AGG_FUNCS})", name="ck_dataset_columns_agg_known"
        ),
        sa.CheckConstraint(
            "length(name) > 0", name="ck_dataset_columns_name_nonempty"
        ),
        sa.CheckConstraint(
            "length(key) BETWEEN 1 AND 64",
            name="ck_dataset_columns_key_sized",
        ),
        # key 里禁掉公式语法的记号，否则 `{key}` 引用切不回这一列
        sa.CheckConstraint(
            KEY_CHECK, name="ck_dataset_columns_key_has_no_formula_token"
        ),
        sa.CheckConstraint(
            f"formula IS NULL OR length(formula) <= {MAX_FORMULA_LENGTH}",
            name="ck_dataset_columns_formula_sized",
        ),
        sa.CheckConstraint(
            f"decimals IS NULL OR decimals BETWEEN 0 AND {MAX_DECIMALS}",
            name="ck_dataset_columns_decimals_sane",
        ),
    )


def _create_records() -> None:
    op.create_table(
        _RECORDS,
        # 对齐 dataset_tables.id；**不建外键**——超表上的外键拖慢每一次写入，
        # 删表时的清行由应用显式做
        sa.Column("table_id", sa.UUID(), nullable=False),
        # 桶起点，也是分区列
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("row_id", sa.UUID(), nullable=False),
        sa.Column("values_json", postgresql.JSONB(), nullable=False),
        sa.Column("overrides_json", postgresql.JSONB(), nullable=True),
        sa.Column("computed_json", postgresql.JSONB(), nullable=True),
        sa.Column("compute_error", postgresql.JSONB(), nullable=True),
        sa.Column("samples_json", postgresql.JSONB(), nullable=True),
        # 无默认值：行来源必须由写它的那条路径显式说出来
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_by_name", sa.Text(), nullable=True),
        *_timestamps(),
        # ⚠ 自然复合键而不是 UUID 代理键：Timescale 要求分区列进每个唯一约束，
        # 而这个键一物三用——幂等去重 / 主查询索引 / 分区约束。列序是刻意的：
        # table_id 前缀定位表、ts 有序支撑「取最后一条」、row_id 补唯一
        sa.PrimaryKeyConstraint(
            "table_id", "ts", "row_id", name="pk_dataset_records"
        ),
        sa.CheckConstraint(
            f"source IN ({RECORD_SOURCES})",
            name="ck_dataset_records_source_known",
        ),
        schema=_SCHEMA,
    )
    _make_hypertable()


def _make_hypertable() -> None:
    """把台账行表变成压缩超表。二级索引一个都不建（§4.2）。"""
    op.execute(
        f"SELECT create_hypertable('{_QUALIFIED_RECORDS}', 'ts', "
        f"chunk_time_interval => interval '{CHUNK_INTERVAL}', "
        "create_default_indexes => FALSE)"
    )
    op.execute(
        f"ALTER TABLE {_QUALIFIED_RECORDS} SET ("
        "timescaledb.compress, "
        f"timescaledb.compress_segmentby = '{SEGMENT_BY}', "
        f"timescaledb.compress_orderby = '{ORDER_BY}')"
    )
    # ⚠ 没有 retention policy：台账默认永久保留（D7），逐表的保留期由夜间
    # 批处理任务消费 `retention_days`，静默删历史是不可逆的
    op.execute(
        f"SELECT add_compression_policy('{_QUALIFIED_RECORDS}', "
        f"INTERVAL '{COMPRESS_AFTER}', if_not_exists => TRUE)"
    )
