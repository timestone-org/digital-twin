"""历史回填的入参与出参。

⚠ 出参里**请求区间与实际区间两份都在**：只给实际区间的话，被 clamp 掉的那一段
在界面上无从对比，用户看到的只是「它补的比我要的少」，而少在哪一头看不出来
（docs/DATASET_DESIGN.md §14.3）。
"""

import uuid

from platform_server.apps.dataset.schemas.common import (
    InputModel,
    OutputModel,
    Utc,
)
from platform_server.apps.dataset.services.backfill_jobs import BackfillStatus


class BackfillStartIn(InputModel):
    """要补哪一段历史。两端都按桶对齐，越界的部分会被 clamp 并逐条说明。"""

    since: Utc
    until: Utc


class BackfillJobOut(OutputModel):
    """一次回填任务的全部对外状态，起任务与查进度共用这一个形状。"""

    table_id: uuid.UUID
    table_code: str
    status: BackfillStatus
    interval_ms: int
    #: 实际回填的区间，两端都是**桶起点**、闭区间
    since: Utc
    until: Utc
    #: 用户原样提交的区间，用来对比出「哪一头被裁了」
    requested_since: Utc
    requested_until: Utc
    is_clamped: bool
    #: 取数路径。⚠ 本仓的点位历史没有连续聚合视图，故恒为 `raw`——留一个永远
    #: 填不上的「快路」字段，等于让界面长期显示一个不存在的加速选项
    fast_path: str
    total_buckets: int
    done_buckets: int
    written_rows: int
    recomputed: int
    recompute_failed: int
    #: 待重算的行数触顶，公式列**没算完**
    is_recompute_truncated: bool
    #: 已经补到哪个桶；一批都还没跑完时是 null
    cursor: Utc | None
    started_at: Utc
    updated_at: Utc
    finished_at: Utc | None
    #: 只在 `status = failed` 时有值
    error: str | None
    message: str
    #: clamp、取数路径、重算触顶这些「用户必须知道」的说明，逐条中文
    notes: list[str]
