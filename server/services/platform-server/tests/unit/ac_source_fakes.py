"""外部只读库（EMS）的进程内假件。

⚠ 它替的是**驱动**，不是被测逻辑——SQL 文本、时区换算与行映射走的都还是真的
`AcSourceReader`，用例因此仍然拦得住取数口径写错。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

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


def _row_limit(params: Mapping[str, object]) -> int:
    limit = params.get("row_limit")
    return limit if isinstance(limit, int) else 0
