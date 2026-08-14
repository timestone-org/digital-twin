"""模型状态的取值目录 —— 建表 CHECK、训练消费者与对外契约共用的唯一真源。

状态机只有一条路：queued → training → ready|failed；重训回到 queued。
口径见 docs/AC_MODEL_DESIGN.md §3.1。
"""

MODEL_STATUS_QUEUED = "queued"
MODEL_STATUS_TRAINING = "training"
MODEL_STATUS_READY = "ready"
MODEL_STATUS_FAILED = "failed"

MODEL_STATUSES: frozenset[str] = frozenset(
    {
        MODEL_STATUS_QUEUED,
        MODEL_STATUS_TRAINING,
        MODEL_STATUS_READY,
        MODEL_STATUS_FAILED,
    }
)

# 半衰期下限（天）。短于一周的半衰期等于只看最近几条样本
MIN_HALF_LIFE_DAYS = 7.0
