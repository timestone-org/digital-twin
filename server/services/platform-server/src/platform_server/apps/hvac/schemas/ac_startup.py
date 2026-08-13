"""开机事件面的对外模型。口径见 docs/AC_STARTUP_DESIGN.md §7。"""

import uuid

from pydantic import Field, computed_field

from platform_server.apps.hvac.schemas.common import (
    InputModel,
    OutputModel,
    Utc,
)

MAX_EXCLUSION_REASON = 500
# 过滤器里一次最多点名几台空调，与全场空调数同量级
MAX_FILTER_SERIALS = 32

Readings = dict[str, dict[str, float | None]]


class StartupEpisodeOut(OutputModel):
    """一次开机事件。

    ⚠ 被人工排除的事件仍然出现在列表里，只是带上排除标记——页面把它置灰保留
    而不是让它消失，否则人会以为自己排掉的那条从数据里没了。
    """

    started_at: Utc
    running_set: list[str]
    complied_at: Utc | None
    outcome: str
    readings: Readings
    # ⚠ null = 这行是 LOGIC_VERSION < 2 抽的，不是「全停时长为零」
    idle_minutes: int | None
    is_excluded: bool
    exclusion_reason: str | None

    @computed_field
    @property
    def duration_minutes(self) -> int | None:
        """达标时长；没达标就没有时长。

        ⚠ 派生而不是单独存一份：与 `complied_at` 分开存的话两者会各自漂移，
        而页面读到的是哪一个全看它先看哪一列。
        """
        if self.complied_at is None:
            return None
        delta = self.complied_at - self.started_at
        return int(delta.total_seconds() // 60)


class StartupBatchOut(OutputModel):
    """一个抽取批次的摘要。`shard_done / shard_total` 就是进度。"""

    id: uuid.UUID
    status: str
    is_current: bool
    params_fingerprint: str
    logic_version: int
    window_start: Utc
    window_end: Utc
    shard_total: int
    shard_done: int
    episode_count: int
    unmatched_exclusion_count: int
    created_at: Utc
    updated_at: Utc


class CombinationCoverageOut(OutputModel):
    """一个运行组合在当前批次里攒了多少条可用样本。"""

    running_set: list[str]
    usable_count: int


class SourceRangeOut(OutputModel):
    """外部数据源里实际有数据的那一段。"""

    start: Utc
    end: Utc


class StartupBatchesOut(OutputModel):
    """批次列表页要的全部东西，一次取回。

    ⚠ `is_stale` 只在**有**当前批次且指纹对不上时为真：一个房间还没算过时
    它是假，页面显示的是「还没算过」而不是「该重算了」——两者要人做的事不同。
    ⚠ `source_range` 为 null 有两种可能：房间一台都没绑数据源，或外库此刻不
    可达。页面两种情况都只能不预设范围，故不再细分。
    """

    items: list[StartupBatchOut]
    current: StartupBatchOut | None
    coverage: list[CombinationCoverageOut]
    expected_fingerprint: str
    is_stale: bool
    source_range: SourceRangeOut | None


class StartupRebuildIn(InputModel):
    """重算的入参：要抽哪一段。

    ⚠ 两端都可省，空请求体 `{}` 表示**全部可用历史**。省掉的那一端按数据源里
    的实际范围算，不写死任何日期——今天的起点是 2023 年只是当下的事实，现场
    会继续产出数据，也可能补录更早的。
    """

    window_start: Utc | None = None
    window_end: Utc | None = None


class StartupRebuildOut(OutputModel):
    """入队的结果。⚠ 它只说「排上了」，不说「算完了」。

    `window_start` / `window_end` 是**实际排进队列的那一段**：入参省掉的一端
    已经按数据源范围补齐，超出数据范围的部分已经裁掉。
    """

    batch_id: uuid.UUID
    status: str
    shard_total: int
    window_start: Utc
    window_end: Utc
    is_clamped: bool


class StartupExclusionIn(InputModel):
    """人工排除的入参。排除人取自调用者身份，不从请求体里读。"""

    reason: str = Field(min_length=1, max_length=MAX_EXCLUSION_REASON)


class StartupExclusionOut(OutputModel):
    """一条人工排除。"""

    started_at: Utc
    reason: str
    excluded_by: str
    created_at: Utc
