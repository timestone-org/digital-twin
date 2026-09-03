"""运行表与节点级执行表（docs/MODELING_DESIGN.md §4.2 与 §4.3）。

⚠ 结果读回、只读回看、重跑同一份图全部读 `graph_snapshot`，不读流水线当前的
`graph_json`（D6）：这条一破，历史运行就会显示今天的参数、配着当时的结果。
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import UuidPrimaryKeyMixin
from platform_server.apps.modeling.models.base import (
    Base,
    CreatedAtMixin,
    EagerDefaultsMixin,
)
from platform_server.apps.modeling.protocols import (
    ACTIVE_RUN_STATUSES,
    NODE_RUN_STATUSES,
    RUN_STATUSES,
    RUN_TRIGGERS,
    sql_values,
)

# 失败原因与 traceback 的截断长度。
# ⚠ 库里不配 CHECK：写这一列的那条路径本身就是「记录失败」，让它因为超长而
# 整个失败，等于把一次可解释的失败变成一次无声的失败。截断是写入方的责任
MAX_ERROR_TEXT_LENGTH = 8_192

_ACTIVE_STATUS_CLAUSE = f"status IN ({sql_values(ACTIVE_RUN_STATUSES)})"


class ModelingRun(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """一次运行。整份图在建行那一刻冻结进 `graph_snapshot`。"""

    __tablename__ = "modeling_runs"

    pipeline_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    status: Mapped[str] = mapped_column(Text, nullable=False)
    # 冻结的整份图，形状与 `graph_json` 相同（D6）
    graph_snapshot: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False
    )
    trigger: Mapped[str] = mapped_column(Text, nullable=False)
    # 取消旗标。⚠ 置位不等于已取消：取消在下一个节点边界才生效（§6.2）
    cancel_requested: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    # 执行者每跑完一个节点写一次，陈旧即判「执行中断」并放开单飞索引
    heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 队列重投递次数，超上限即判毒丸落 failed（D25）
    attempt: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 冗余，列表页排序用
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 取数行数，第一手规模指标
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_truncated: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    error_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ⚠ 冗余存一份用户名是刻意的：账号可能被删，而这一行要一直答得出「谁跑的」
    created_by_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["pipeline_id"],
            ["platform.modeling_pipelines.id"],
            name="fk_modeling_runs_pipeline_id",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            f"status IN ({sql_values(RUN_STATUSES)})", name="status_known"
        ),
        CheckConstraint(
            f"trigger IN ({sql_values(RUN_TRIGGERS)})", name="trigger_known"
        ),
        CheckConstraint(
            "jsonb_typeof(graph_snapshot) = 'object'",
            name="graph_snapshot_is_an_object",
        ),
        CheckConstraint("attempt >= 0", name="attempt_nonnegative"),
        CheckConstraint(
            "duration_ms IS NULL OR duration_ms >= 0",
            name="duration_nonnegative",
        ),
        CheckConstraint(
            "row_count IS NULL OR row_count >= 0", name="row_count_nonnegative"
        ),
        # ⚠ 一条流水线同时只能有一次在途运行，由库保证而不是 Redis 锁：锁与
        # run 行的生死是两件事，提前过期就并发跑两次、没释放就发不起来（D17）
        Index(
            "uq_modeling_runs_one_active_per_pipeline",
            "pipeline_id",
            unique=True,
            postgresql_where=text(_ACTIVE_STATUS_CLAUSE),
        ),
        Index(
            "ix_modeling_runs_pipeline_id_created_at",
            "pipeline_id",
            text("created_at DESC"),
        ),
    )


class ModelingNodeRun(UuidPrimaryKeyMixin, EagerDefaultsMixin, Base):
    """一次运行里的一个节点。刷新页面后靠它重建进度视图（D7、D23）。"""

    __tablename__ = "modeling_node_runs"

    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    # 图里的节点 id。⚠ 上下文键一律用它，`alias` 只做展示：两个节点起同名
    # alias 时，按 alias 建键会让后执行的那个静默覆盖前者的输出（D5）
    node_id: Mapped[str] = mapped_column(Text, nullable=False)
    # 算子 code，冗余存一份，列表页不必回查图
    operator: Mapped[str] = mapped_column(Text, nullable=False)
    alias: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 拓扑序，界面按它排
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 含 traceback
    error_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 这一步学到的参数，按列 key 建键；不带拟合的算子是 NULL。
    # ⚠ 独立成列而不是塞进 `preview_json`：摘要有字节预算、超了会被静默削掉，
    # 而这是发布件的原料，削掉的表现是「模型发布成功、上线才炸」
    # （docs/MODELING_PLATFORM_DESIGN.md D1）
    fitted_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )
    # `{"inputs": {端口: [列 key…]}, "outputs": {端口: [列 key…]}}`，
    # 这一步**实际**看到与产出的列。发布时据它算逐步的输入契约（D3）
    io_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # `{端口名: 结果摘要}`，有硬上限（D19）
    preview_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )
    # ⚠ 行截断与列截断各有各的标志位，这一位只说「摘要整体被削过」：合在一起
    # 的话，几万行的帧只留 200 行而界面无从区分「本来就这么少」与「被切了」
    preview_truncated: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["run_id"],
            ["platform.modeling_runs.id"],
            name="fk_modeling_node_runs_run_id",
            ondelete="CASCADE",
        ),
        UniqueConstraint("run_id", "node_id"),
        Index("ix_modeling_node_runs_run_id_ordinal", "run_id", "ordinal"),
        CheckConstraint(
            f"status IN ({sql_values(NODE_RUN_STATUSES)})", name="status_known"
        ),
        CheckConstraint("length(node_id) > 0", name="node_id_nonempty"),
        CheckConstraint("ordinal >= 0", name="ordinal_nonnegative"),
        CheckConstraint(
            "duration_ms IS NULL OR duration_ms >= 0",
            name="duration_nonnegative",
        ),
    )
