"""分片加 `skipped` 终态，批次加两条「不完整不许上台」的约束。

两条批次约束按扩展步加成 `NOT VALID`：现网正躺着一行 43/45 却是 ready 且
is_current 的批次，先把新写入堵死，等那一行修好之后再补一条迁移 `VALIDATE`。
⚠ NOT VALID 只是跳过建约束时的全表校验，此后每一次 INSERT/UPDATE 照样受检。

⚠ 那一行**是应用自己写出来的，成因未查明**：没有人改过库，且实测两次抽取
期间 worker 都没有重启过，故「关停时被取消」这条解释不成立；另有 6 条队列
消息被读取并确认却没留下任何日志。所以这两条约束是**防御性**的——不依赖
知道成因，直接让这个状态在库里无法表示。

Revision ID: c63d4f2a80e1
Revises: b52e7d0c41a9
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c63d4f2a80e1"
down_revision: str | None = "b52e7d0c41a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# ⚠ 与 apps/hvac/startups.py 同口径。那边加取值时，这里要跟一条新迁移改 CHECK
_SHARD_STATUSES = "'done', 'failed', 'pending', 'skipped'"
_SHARD_STATUSES_BEFORE = "'done', 'failed', 'pending'"

_STATUS_CHECK = "ck_hvac_ac_startup_shards_status_known"
_READY_CHECK = "ck_hvac_ac_startup_batches_ready_is_complete"
_CURRENT_CHECK = "ck_hvac_ac_startup_batches_current_is_ready"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _restate_shard_statuses(_SHARD_STATUSES)
    # 加约束不回填也不重写表；NOT VALID 让它不去扫存量行
    op.execute(
        f"ALTER TABLE platform.hvac_ac_startup_batches "
        f"ADD CONSTRAINT {_READY_CHECK} "
        f"CHECK (status <> 'ready' OR shard_done = shard_total) NOT VALID"
    )
    op.execute(
        f"ALTER TABLE platform.hvac_ac_startup_batches "
        f"ADD CONSTRAINT {_CURRENT_CHECK} "
        f"CHECK (NOT is_current OR status = 'ready') NOT VALID"
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.execute(
        f"ALTER TABLE platform.hvac_ac_startup_batches "
        f"DROP CONSTRAINT {_CURRENT_CHECK}"
    )
    op.execute(
        f"ALTER TABLE platform.hvac_ac_startup_batches "
        f"DROP CONSTRAINT {_READY_CHECK}"
    )
    # 回退前先把跳过的分片归成待跑，否则旧 CHECK 建不起来
    op.execute(
        "UPDATE platform.hvac_ac_startup_shards "
        "SET status = 'pending' WHERE status = 'skipped'"
    )
    _restate_shard_statuses(_SHARD_STATUSES_BEFORE)


def _restate_shard_statuses(values: str) -> None:
    """重写分片状态的取值 CHECK。

    Args: values（CHECK 里的字面量列表）。
    """
    op.execute(
        f"ALTER TABLE platform.hvac_ac_startup_shards "
        f"DROP CONSTRAINT {_STATUS_CHECK}"
    )
    op.execute(
        f"ALTER TABLE platform.hvac_ac_startup_shards "
        f"ADD CONSTRAINT {_STATUS_CHECK} CHECK (status IN ({values}))"
    )
