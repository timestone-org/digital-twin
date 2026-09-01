"""建分析建模的五张表（docs/MODELING_DESIGN.md §4）。

五张都是新建表，索引随建表一起下，不需要 CONCURRENTLY，也没有回填。
全是元数据与执行记录，不上 TimescaleDB。

Revision ID: f3c9a15d82e6
Revises: e2b86d0f45c3
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f3c9a15d82e6"
down_revision: str | None = "e2b86d0f45c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_PIPELINES = "modeling_pipelines"
_RUNS = "modeling_runs"
_NODE_RUNS = "modeling_node_runs"
_MODEL_VERSIONS = "modeling_model_versions"
_BINDINGS = "modeling_bindings"

# ⚠ 下面六组取值是**写死的字面量**，不许改成 import
# `apps/modeling/protocols.py`：迁移是冻结件，而那是个活常量——将来给某一组加
# 一档，同一个 revision 会在旧库建出旧集合、在新建库建出新集合，且没有任何
# 东西会报错。两侧不许漂由契约测试盯着。
RUN_STATUSES = (
    "'cancelled', 'cancelling', 'failed', 'pending', 'running', 'succeeded'"
)
# 在途三格：单飞的部分唯一索引只盯这个集合
ACTIVE_RUN_STATUSES = "'cancelling', 'pending', 'running'"
NODE_RUN_STATUSES = (
    "'cancelled', 'cancelling', 'failed', 'pending', 'running', "
    "'skipped', 'succeeded'"
)
RUN_TRIGGERS = "'api', 'manual'"
MODEL_TASKS = "'classification', 'regression'"
SERVING_CHANNELS = "'binary', 'json'"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_pipelines()
    _create_runs()
    _create_node_runs()
    _create_model_versions()
    _create_bindings()


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    # ⚠ 顺序与建表相反：绑定与模型版本上的 RESTRICT 外键会挡住先删父表
    op.drop_table(_BINDINGS, schema=_SCHEMA)
    op.drop_table(_MODEL_VERSIONS, schema=_SCHEMA)
    op.drop_index(
        "ix_modeling_node_runs_run_id_ordinal", _NODE_RUNS, schema=_SCHEMA
    )
    op.drop_table(_NODE_RUNS, schema=_SCHEMA)
    op.drop_index(
        "ix_modeling_runs_pipeline_id_created_at", _RUNS, schema=_SCHEMA
    )
    op.drop_index(
        "uq_modeling_runs_one_active_per_pipeline", _RUNS, schema=_SCHEMA
    )
    op.drop_table(_RUNS, schema=_SCHEMA)
    op.drop_table(_PIPELINES, schema=_SCHEMA)


def _created_at() -> sa.Column[datetime]:
    """建表时刻。时刻一律 timestamptz 存 UTC。"""
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        server_default=sa.text("now()"),
        nullable=False,
    )


def _timestamps() -> tuple[sa.Column[datetime], sa.Column[datetime]]:
    """建表与更新两列时刻。"""
    return (
        _created_at(),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def _actor() -> tuple[sa.Column[str], sa.Column[str]]:
    """操作人与冗余的一份用户名——账号删了这行也要答得出是谁干的。"""
    return (
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_by_name", sa.Text(), nullable=True),
    )


def _create_pipelines() -> None:
    op.create_table(
        _PIPELINES,
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        # 图本体，边带端口，形状见 §4.6
        sa.Column("graph_json", postgresql.JSONB(), nullable=False),
        # 冗余的台账 code 清单，供「改这张台账会影响谁」反查
        sa.Column(
            "source_table_codes",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        *_actor(),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_modeling_pipelines"),
        # `code` 是导出导入的对齐键，撞了就是两条流水线共用身份
        sa.UniqueConstraint("code", name="uq_modeling_pipelines_code"),
        sa.CheckConstraint(
            "length(code) BETWEEN 1 AND 64",
            name="ck_modeling_pipelines_code_sized",
        ),
        sa.CheckConstraint(
            "length(name) > 0", name="ck_modeling_pipelines_name_nonempty"
        ),
        sa.CheckConstraint(
            "jsonb_typeof(graph_json) = 'object'",
            name="ck_modeling_pipelines_graph_is_an_object",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(source_table_codes) = 'array'",
            name="ck_modeling_pipelines_source_table_codes_are_an_array",
        ),
        schema=_SCHEMA,
    )


def _create_runs() -> None:
    op.create_table(
        _RUNS,
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("pipeline_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        # 建 run 那一刻冻结的整份图，历史运行据它复现
        sa.Column("graph_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("trigger", sa.Text(), nullable=False),
        sa.Column(
            "cancel_requested",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        # 执行者每跑完一个节点写一次，陈旧即判「执行中断」
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "attempt",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=True),
        sa.Column(
            "source_truncated",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("error_text", sa.Text(), nullable=True),
        *_actor(),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name="pk_modeling_runs"),
        sa.ForeignKeyConstraint(
            ["pipeline_id"],
            ["platform.modeling_pipelines.id"],
            name="fk_modeling_runs_pipeline_id",
            ondelete="CASCADE",
        ),
        *_run_checks(),
        schema=_SCHEMA,
    )
    _create_run_indexes()


def _run_checks() -> tuple[sa.CheckConstraint, ...]:
    """运行表的全部 CHECK。装成一组只为让建表那段不超过函数行数上限。"""
    return (
        sa.CheckConstraint(
            f"status IN ({RUN_STATUSES})", name="ck_modeling_runs_status_known"
        ),
        sa.CheckConstraint(
            f"trigger IN ({RUN_TRIGGERS})",
            name="ck_modeling_runs_trigger_known",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(graph_snapshot) = 'object'",
            name="ck_modeling_runs_graph_snapshot_is_an_object",
        ),
        sa.CheckConstraint(
            "attempt >= 0", name="ck_modeling_runs_attempt_nonnegative"
        ),
        sa.CheckConstraint(
            "duration_ms IS NULL OR duration_ms >= 0",
            name="ck_modeling_runs_duration_nonnegative",
        ),
        sa.CheckConstraint(
            "row_count IS NULL OR row_count >= 0",
            name="ck_modeling_runs_row_count_nonnegative",
        ),
    )


def _create_run_indexes() -> None:
    """单飞索引与列表页索引。"""
    # ⚠ 一条流水线同时只能有一次在途运行，这是数据库不变量而不是一把有 TTL
    # 的锁：并发插入时由 Postgres 直接拒绝，第二个请求收到的是 409 而不是
    # 「看起来成功了但没跑」（D17）
    op.create_index(
        "uq_modeling_runs_one_active_per_pipeline",
        "modeling_runs",
        ["pipeline_id"],
        unique=True,
        postgresql_where=sa.text(f"status IN ({ACTIVE_RUN_STATUSES})"),
        schema=_SCHEMA,
    )
    op.create_index(
        "ix_modeling_runs_pipeline_id_created_at",
        "modeling_runs",
        ["pipeline_id", sa.text("created_at DESC")],
        schema=_SCHEMA,
    )


def _create_node_runs() -> None:
    op.create_table(
        _NODE_RUNS,
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("run_id", sa.UUID(), nullable=False),
        # 图里的节点 id，也是执行上下文的键
        sa.Column("node_id", sa.Text(), nullable=False),
        # 算子 code，冗余一份让列表页不必回查图
        sa.Column("operator", sa.Text(), nullable=False),
        sa.Column("alias", sa.Text(), nullable=True),
        # 拓扑序
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        # 含 traceback
        sa.Column("error_text", sa.Text(), nullable=True),
        # `{端口名: 结果摘要}`，有硬上限
        sa.Column("preview_json", postgresql.JSONB(), nullable=True),
        sa.Column(
            "preview_truncated",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_modeling_node_runs"),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["platform.modeling_runs.id"],
            name="fk_modeling_node_runs_run_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "run_id", "node_id", name="uq_modeling_node_runs_run_id_node_id"
        ),
        *_node_run_checks(),
        schema=_SCHEMA,
    )
    op.create_index(
        "ix_modeling_node_runs_run_id_ordinal",
        "modeling_node_runs",
        ["run_id", "ordinal"],
        schema=_SCHEMA,
    )


def _node_run_checks() -> tuple[sa.CheckConstraint, ...]:
    """节点级执行表的全部 CHECK。"""
    return (
        sa.CheckConstraint(
            f"status IN ({NODE_RUN_STATUSES})",
            name="ck_modeling_node_runs_status_known",
        ),
        sa.CheckConstraint(
            "length(node_id) > 0",
            name="ck_modeling_node_runs_node_id_nonempty",
        ),
        sa.CheckConstraint(
            "ordinal >= 0", name="ck_modeling_node_runs_ordinal_nonnegative"
        ),
        sa.CheckConstraint(
            "duration_ms IS NULL OR duration_ms >= 0",
            name="ck_modeling_node_runs_duration_nonnegative",
        ),
    )


def _create_model_versions() -> None:
    op.create_table(
        _MODEL_VERSIONS,
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("pipeline_id", sa.UUID(), nullable=False),
        sa.Column("run_id", sa.UUID(), nullable=False),
        # 按流水线自增
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        # 建模算子 code
        sa.Column("algo", sa.Text(), nullable=False),
        sa.Column("task", sa.Text(), nullable=False),
        sa.Column("servable", sa.Boolean(), nullable=False),
        sa.Column("serving_channel", sa.Text(), nullable=False),
        sa.Column("unservable_reason", sa.Text(), nullable=True),
        # 纯数据的可服务表示，形状见 §7.3
        sa.Column("serving_json", postgresql.JSONB(), nullable=False),
        # 有序特征列 key = 对外输入契约
        sa.Column("feature_keys", postgresql.JSONB(), nullable=False),
        sa.Column("target_key", sa.Text(), nullable=False),
        sa.Column("metrics_json", postgresql.JSONB(), nullable=False),
        sa.Column("fingerprint_json", postgresql.JSONB(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        *_actor(),
        _created_at(),
        sa.PrimaryKeyConstraint("id", name="pk_modeling_model_versions"),
        *_model_version_foreign_keys(),
        *_model_version_unique_keys(),
        *_model_version_checks(),
        schema=_SCHEMA,
    )


def _model_version_foreign_keys() -> tuple[sa.ForeignKeyConstraint, ...]:
    """模型版本的两条外键，都是 RESTRICT。"""
    return (
        # ⚠ RESTRICT 而不是 CASCADE：删流水线前必须先退役它的模型
        sa.ForeignKeyConstraint(
            ["pipeline_id"],
            ["platform.modeling_pipelines.id"],
            name="fk_modeling_model_versions_pipeline_id",
            ondelete="RESTRICT",
        ),
        # ⚠ 同为 RESTRICT：被发布过的运行删不掉，运行保留期清理必须先跳过它们
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["platform.modeling_runs.id"],
            name="fk_modeling_model_versions_run_id",
            ondelete="RESTRICT",
        ),
    )


def _model_version_unique_keys() -> tuple[sa.UniqueConstraint, ...]:
    """一次运行至多发布一个版本；版本号按流水线自增。"""
    return (
        sa.UniqueConstraint("run_id", name="uq_modeling_model_versions_run_id"),
        sa.UniqueConstraint(
            "pipeline_id",
            "version",
            name="uq_modeling_model_versions_pipeline_id_version",
        ),
    )


def _model_version_checks() -> tuple[sa.CheckConstraint, ...]:
    """模型版本表的全部 CHECK。"""
    return (
        sa.CheckConstraint(
            "version >= 1", name="ck_modeling_model_versions_version_positive"
        ),
        sa.CheckConstraint(
            "length(name) > 0",
            name="ck_modeling_model_versions_name_nonempty",
        ),
        sa.CheckConstraint(
            "length(algo) > 0",
            name="ck_modeling_model_versions_algo_nonempty",
        ),
        sa.CheckConstraint(
            "length(target_key) > 0",
            name="ck_modeling_model_versions_target_key_nonempty",
        ),
        sa.CheckConstraint(
            f"task IN ({MODEL_TASKS})",
            name="ck_modeling_model_versions_task_known",
        ),
        sa.CheckConstraint(
            f"serving_channel IN ({SERVING_CHANNELS})",
            name="ck_modeling_model_versions_serving_channel_known",
        ),
        # 不可服务就必须留一句人话原因，界面才有得显示
        sa.CheckConstraint(
            "servable OR unservable_reason IS NOT NULL",
            name="ck_modeling_model_versions_unservable_has_reason",
        ),
        *_model_version_json_checks(),
    )


def _model_version_json_checks() -> tuple[sa.CheckConstraint, ...]:
    """四列 JSONB 的形状。存错了形状读侧只会静默少一批东西。"""
    return (
        sa.CheckConstraint(
            "jsonb_typeof(feature_keys) = 'array'",
            name="ck_modeling_model_versions_feature_keys_are_an_array",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(serving_json) = 'object'",
            name="ck_modeling_model_versions_serving_is_an_object",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(metrics_json) = 'object'",
            name="ck_modeling_model_versions_metrics_is_an_object",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(fingerprint_json) = 'object'",
            name="ck_modeling_model_versions_fingerprint_is_an_object",
        ),
    )


def _create_bindings() -> None:
    op.create_table(
        _BINDINGS,
        sa.Column("id", sa.UUID(), nullable=False),
        # `dataset_formulas.code` 的**逻辑**引用，不建外键：跨 app 的表间外键
        # 会让建模的 models 依赖台账的 models，孤儿由应用层守卫
        sa.Column("fx_code", sa.Text(), nullable=False),
        sa.Column("model_version_id", sa.UUID(), nullable=False),
        # 有序的 `[{param, feature}]`，按位置生成
        sa.Column("param_map_json", postgresql.JSONB(), nullable=False),
        # 绑定时的形参名，provider 每次加载时比对
        sa.Column("param_names_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column(
            "is_enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        *_actor(),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_modeling_bindings"),
        # ⚠ RESTRICT：还有人绑着的版本删不掉
        sa.ForeignKeyConstraint(
            ["model_version_id"],
            ["platform.modeling_model_versions.id"],
            name="fk_modeling_bindings_model_version_id",
            ondelete="RESTRICT",
        ),
        # 一个公式库 code 至多绑一个模型版本
        sa.UniqueConstraint("fx_code", name="uq_modeling_bindings_fx_code"),
        *_binding_checks(),
        schema=_SCHEMA,
    )


def _binding_checks() -> tuple[sa.CheckConstraint, ...]:
    """绑定表的全部 CHECK。"""
    return (
        sa.CheckConstraint(
            "length(fx_code) BETWEEN 1 AND 64",
            name="ck_modeling_bindings_fx_code_sized",
        ),
        # 映射必须是数组：存成对象就丢了顺序，而实参是按位置供给的
        sa.CheckConstraint(
            "jsonb_typeof(param_map_json) = 'array'",
            name="ck_modeling_bindings_param_map_is_an_array",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(param_names_snapshot) = 'array'",
            name="ck_modeling_bindings_param_names_snapshot_is_an_array",
        ),
    )
