"""记录面的入参与出参。ORM 模型绝不直接返给 HTTP 层。

⚠ 出参里的 `values` **已经是 effective**（人工修正优先，docs/DATASET_DESIGN.md
D4）：前端不必也不该再叠一遍 `overrides[].value`。修正前的原值是刻意不给的。
"""

import uuid
from typing import Annotated, Any

from pydantic import Field

from platform_server.apps.dataset.protocols import RecordSource
from platform_server.apps.dataset.schemas.common import (
    ColumnKey,
    InputModel,
    Note,
    OutputModel,
    Utc,
)

# 一次提交最多带多少个列 key。⚠ 有上限不是省流量：它是个无界字典入参
MAX_VALUE_KEYS = 500
# 一次批量撤销最多点名多少列
MAX_CLEAR_KEYS = 200
# `:series` 一次最多问多少列
MAX_SERIES_KEYS = 50
# `:series` 一次最多回多少行。触顶时留下的是**最新**那批（§6.2）
MAX_SERIES_ROWS = 20_000

# 提交上来的一行值。未定义的列 key 一律丢弃，故这里不限键名
RawValues = Annotated[dict[str, Any], Field(max_length=MAX_VALUE_KEYS)]


class OverrideOut(OutputModel):
    """一格人工修正的痕迹。

    ⚠ 它只是**标记**，不参与取值——取值已经在 `values` 里生效了。
    ⚠ `by_name` 冗余存一份是刻意的：账号可能被删，而这一格要一直答得出
    「谁改的」。
    """

    value: Any
    by: str | None
    by_name: str | None
    at: Utc
    reason: str | None


class RecordOut(OutputModel):
    """一行台账。"""

    row_id: uuid.UUID
    ts: Utc
    #: 生效值：人工修正优先于采集与录入值
    values: dict[str, Any]
    #: 整行没有修正时给 null 而不是空字典，前端少判一层
    overrides: dict[str, OverrideOut] | None
    #: 各点位汇总列的桶内样本数。⚠ `n = 0` 与「值为空」是两件事
    samples: dict[str, int] | None
    computed: dict[str, Any]
    #: 求值失败的列 `{列key: 原因}`，null = 全部成功
    compute_error: dict[str, str] | None
    source: RecordSource
    created_by_name: str | None
    created_at: Utc
    updated_at: Utc


class RecordWriteOut(OutputModel):
    """一次写入的回执。

    ⚠ `has_stale_downstream`：往回补录或改历史行之后，它**之后**那些行里的
    `PREV` / 时间窗 / 整表公式结果就不准了。本期只如实上报、不做级联重算——
    级联的边界在最坏情况下是整表，而它由一次单行编辑触发（§5.10）。
    """

    record: RecordOut
    has_stale_downstream: bool


class RecordDeleteOut(OutputModel):
    """删一行的回执。删除同样会让它之后那些行的公式结果失真。"""

    deleted_row_id: uuid.UUID
    has_stale_downstream: bool


class OverrideWriteOut(RecordWriteOut):
    """写 / 撤销人工修正的回执。

    ⚠ `cleared` 不能省：提交为空的那几格是**撤销修正**而不是「修正成空」，
    不分开说的话，用户撤了一格却看到「已修正 1 格」。
    """

    cleared: list[str]


class RecordCreateIn(InputModel):
    """录入一行。"""

    #: 数据时间。缺省取此刻
    ts: Utc | None = None
    values: RawValues = Field(default_factory=dict[str, Any])


class RecordUpdateIn(InputModel):
    """改一行的原始值，可连带改数据时间。

    ⚠ 改 `ts` 会走「先删后插」：`ts` 是分区键，就地 UPDATE 不合法（§4.3b）。
    行标识与录入署名原样带过去，前端持有的引用不会失效。
    """

    ts: Utc | None = None
    values: RawValues = Field(default_factory=dict[str, Any])


class OverrideWriteIn(InputModel):
    """把一行里若干格改成人工判断的值。

    ⚠ 只认 `source='point'` 的列：人工录入列请直接编辑原始值、公式列请改公式，
    两者都当场报错而不是静默忽略。
    ⚠ 某一格提交为空 = 撤销那一格的修正。
    """

    values: RawValues = Field(min_length=1)
    reason: Note | None = None


class OverrideClearIn(InputModel):
    """撤销一行的人工修正。`keys` 缺省表示整行全撤。"""

    keys: list[ColumnKey] | None = Field(
        default=None, max_length=MAX_CLEAR_KEYS
    )


class OverrideBulkClearIn(InputModel):
    """按列 + 时间范围批量撤销人工修正（仪表修好之后整段退回自动值）。

    ⚠ 时间范围留空是**不限**。界面不许把「不限」做成默认值：一次误点就抹掉
    三年的修正，而回执只有一个数字，看不出抹掉了什么（§7.8）。
    """

    column_keys: list[ColumnKey] = Field(
        min_length=1, max_length=MAX_CLEAR_KEYS
    )
    since: Utc | None = None
    until: Utc | None = None


class OverrideBulkClearOut(OutputModel):
    """批量撤销的回执。"""

    cleared_rows: int
    #: 被清掉的格数。一行可能清掉多列
    cleared_cells: int
    recomputed: int
    #: 重算中出现求值错误的行数
    failed: int
    #: 待处理的行数触顶，本次只处理了最早的 `limit` 行
    is_truncated: bool
    limit: int


class LatestOut(OutputModel):
    """最后一行的值。大屏实时取数就读它。"""

    #: 一行都没有时给 null
    ts: Utc | None
    values: dict[str, Any]
    computed: dict[str, Any]


class DatasetSeriesPointOut(OutputModel):
    """序列上的一个点。

    ⚠ 字段名与点位历史读侧的 `HistoryPointOut` 对齐（`ts` / `value`），
    趋势页的渲染代码因此可以两边共用一份。
    ⚠ 类名带 `Dataset` 前缀是被迫的：空调面已有一个 `SeriesPointOut`，
    同名会让 FastAPI 把**两边**的形状名都改成带模块路径的长名，而那会当场
    打断前端已经钉住空调那份的契约用例。
    """

    ts: Utc
    value: Any


class SeriesOut(OutputModel):
    """若干列的时间序列，按 ts 升序。

    ⚠ `is_truncated` 与 `limit` 必须如实给：只给 `series` 的话，前端分不清
    「这段时间就这么多数据」与「数据太多被砍了」，用户看到的是一段看不出
    不完整的曲线（§6.2）。
    """

    series: dict[str, list[DatasetSeriesPointOut]]
    is_truncated: bool
    limit: int


class RecomputeIn(InputModel):
    """重算公式列。时间范围留空表示整表。"""

    since: Utc | None = None
    until: Utc | None = None


class RecomputeOut(OutputModel):
    """一次重算的回执。"""

    recomputed: int
    failed: int
    #: 待重算的行数触顶，本次只算了最早的 `limit` 行
    is_truncated: bool
    limit: int
