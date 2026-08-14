"""开机事件的取值目录 —— 批次状态与事件结果的唯一真源。

它是常量表不是数据库表：建表的 CHECK、抽取引擎的产出与对外契约都从这里取。
口径见 docs/AC_STARTUP_DESIGN.md §4。
"""

BATCH_STATUS_RUNNING = "running"
BATCH_STATUS_READY = "ready"
BATCH_STATUS_FAILED = "failed"

BATCH_STATUSES: frozenset[str] = frozenset(
    {BATCH_STATUS_RUNNING, BATCH_STATUS_READY, BATCH_STATUS_FAILED}
)

SHARD_STATUS_PENDING = "pending"
SHARD_STATUS_DONE = "done"
SHARD_STATUS_FAILED = "failed"
# 批次已经不在跑了，这一片不再抽取。⚠ 它是终态而不是「还没跑」：分片行停在
# pending 时，看进度的人与 claim_stale 都会以为它还在路上
SHARD_STATUS_SKIPPED = "skipped"

SHARD_STATUSES: frozenset[str] = frozenset(
    {
        SHARD_STATUS_PENDING,
        SHARD_STATUS_DONE,
        SHARD_STATUS_FAILED,
        SHARD_STATUS_SKIPPED,
    }
)

# 房间达标了，这条可以进训练
OUTCOME_USABLE = "usable"
# 窗口关闭后运行组合变过，记录但不训练
OUTCOME_SET_CHANGED = "set_changed"
# 到上限仍未达标
OUTCOME_TIMEOUT = "timeout"
# 窗口内出现了连续超限的缺失 / NULL / 清零
OUTCOME_DATA_GAP = "data_gap"

OUTCOMES: frozenset[str] = frozenset(
    {
        OUTCOME_USABLE,
        OUTCOME_SET_CHANGED,
        OUTCOME_TIMEOUT,
        OUTCOME_DATA_GAP,
    }
)

# 每个房间保留最近几个批次，更老的清理（§4.1）
BATCH_RETENTION = 3


def sql_values(names: frozenset[str]) -> str:
    """把一组字面量摊成 CHECK 约束里的 `'a', 'b'`，顺序固定。

    Args: names。
    """
    return ", ".join(f"'{name}'" for name in sorted(names))
