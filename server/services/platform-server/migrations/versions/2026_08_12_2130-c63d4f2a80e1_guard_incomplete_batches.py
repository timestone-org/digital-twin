"""分片加 `skipped` 终态，批次加两条「不完整不许上台」的约束。

两条批次约束按扩展步加成 `NOT VALID`：现网正躺着一行 43/45 却是 ready 且
is_current 的批次，先把新写入堵死，等那一行修好之后再补一条迁移 `VALIDATE`。
⚠ NOT VALID 只是跳过建约束时的全表校验，此后每一次 INSERT/UPDATE 照样受检——
也就是说**那一行修好之前，任何新批次都切换不成功**：`promote_current` 让位时
会更新到它，当场撞上这条 CHECK 而让整个收尾事务回滚。

⚠ 那一行的**成因没有查实**，所以这两条约束是防御性的：不指望知道成因，直接
让这个状态在库里无法表示。已排除的：`_publish` 没有跑过——`shard_done` 停在
比较之前写下的 43、`episode_count` 是默认值 0 而当时库里已有 945 条事件、两个
容器的日志里都没有 `ac_startup_batch_ready`；那次写入也没有走 ORM——状态是在
09:16:22（:rebuild 收到 409）与 09:18:03（:rebuild 收到 202）之间变的，而
`updated_at` 停在 09:06:12，该列由 ORM 的 onupdate 维护且表上没有触发器。
两次抽取期间 worker 都没重启过，故「关停时被取消」也不成立。

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
