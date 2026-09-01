"""外库与队列的进程内替身。

⚠ 它们替的是**驱动**，不是被测逻辑——SQL 文本、时区换算与行映射走的都还是
生产那条路径；替身只负责「不连真库」。

从 conftest 拆出来是因为模块行数闸：夹具与替身混在一处时，加一个替身就要
在一个六百行的文件里找位置。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from lib.stream import StreamEntry, StreamGroup
from platform_server.apps.hvac.datasets import (
    DATASET_RAW_MINUTE,
    SOURCE_TIME_COLUMN,
    find_dataset,
    metric_keys,
)


def full_shape() -> dict[str, str]:
    """一个形状齐备的对象：时间列 + 目录里的全部指标列。"""
    dataset = find_dataset(DATASET_RAW_MINUTE)
    assert dataset is not None
    columns = {SOURCE_TIME_COLUMN: "datetime"}
    columns.update(dict.fromkeys(metric_keys(dataset), "float"))
    return columns


def _row_limit(params: Mapping[str, object]) -> int:
    """SQL 里的行数上限；没给或不是整数按不限处理。"""
    limit = params.get("row_limit")
    return limit if isinstance(limit, int) else 0


@dataclass
class FakeAcSource:
    """替掉驱动的假外库：按 SQL 里的特征串分派，不解析 SQL。

    ⚠ 它替的是**驱动**，不是被测逻辑——SQL 文本、时区换算与行映射走的都还是
    真的 `AcSourceReader`，故用例仍然能拦住取数口径写错。
    """

    columns: dict[str, dict[str, str]] = field(default_factory=dict)
    shaped_objects: list[str] = field(default_factory=list)
    captions: list[dict[str, object]] = field(default_factory=list)
    extent: list[dict[str, object]] = field(default_factory=list)
    samples: list[dict[str, object]] = field(default_factory=list)
    buckets: list[dict[str, object]] = field(default_factory=list)
    queries: list[tuple[str, dict[str, object]]] = field(default_factory=list)
    failure: Exception | None = None

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]:
        self.queries.append((sql, dict(params)))
        if self.failure is not None:
            raise self.failure
        if "INFORMATION_SCHEMA.COLUMNS" in sql:
            return [{"object_name": name} for name in self.shaped_objects]
        if "KTInfo" in sql:
            return list(self.captions)
        if "MIN(" in sql:
            return list(self.extent)
        if "DATEADD" in sql:
            return list(self.buckets)
        return list(self.samples)[: _row_limit(params)]

    async def describe_columns(
        self, object_names: Sequence[str]
    ) -> dict[str, dict[str, str]]:
        if self.failure is not None:
            raise self.failure
        return {
            name: self.columns[name]
            for name in object_names
            if name in self.columns
        }


@dataclass
class InMemoryStream:
    """进程内的流假件，满足 `StreamLike`。

    ⚠ `lib.testing` 的 `InMemoryCache` 满足的是 `CacheLike`，那上面没有任何流
    操作，故这里另造一件而不是复用。它刻意保留待确认表：不确认的消息能被再取
    一次，「重复投递」这条才测得出来。
    """

    entries: list[StreamEntry] = field(default_factory=list[StreamEntry])
    pending: list[StreamEntry] = field(default_factory=list[StreamEntry])
    acked: list[str] = field(default_factory=list[str])
    groups: list[str] = field(default_factory=list[str])
    reads: list[tuple[str, int, int]] = field(
        default_factory=list[tuple[str, int, int]]
    )
    claims: list[tuple[str, int, int]] = field(
        default_factory=list[tuple[str, int, int]]
    )
    failure: Exception | None = None
    _serial: int = 0

    async def publish(self, stream: str, fields: Mapping[str, str]) -> str:
        self._serial += 1
        entry_id = f"{stream}:{self._serial}"
        self.entries.append(StreamEntry(entry_id=entry_id, fields=dict(fields)))
        return entry_id

    async def ensure_group(self, target: StreamGroup) -> None:
        self.groups.append(target.group)

    async def read_group(
        self, target: StreamGroup, *, count: int, block_ms: int
    ) -> list[StreamEntry]:
        self.reads.append((target.group, count, block_ms))
        if self.failure is not None:
            raise self.failure
        taken = self.entries[:count]
        del self.entries[:count]
        self.pending.extend(taken)
        return taken

    async def claim_stale(
        self, target: StreamGroup, *, min_idle_ms: int, count: int
    ) -> list[StreamEntry]:
        self.claims.append((target.group, min_idle_ms, count))
        return []

    async def ack(self, target: StreamGroup, entry_id: str) -> None:
        self.acked.append(f"{target.group}:{entry_id}")
        self.pending = [
            item for item in self.pending if item.entry_id != entry_id
        ]

    async def close(self) -> None:
        self.entries.clear()
