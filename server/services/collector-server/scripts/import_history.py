"""将校验过的点位历史 CSV 追加到采集归档。"""

import argparse
import asyncio
import csv
from collections.abc import Iterator, Sequence
from datetime import datetime
from itertools import islice
from math import isfinite
from pathlib import Path
from typing import TypedDict
from uuid import UUID

from collector_server.apps.collect.plan.client import PlanClient
from collector_server.apps.collect.services import PointHistoryService
from collector_server.settings import Settings
from collectwire import CollectPlan
from lib.config import load_settings_or_exit
from lib.db import Database, PoolProfile
from lib.logging import configure_logging, get_logger

_logger = get_logger("collect.history_import")


class ArchiveRow(TypedDict):
    """归档宽表可追加的一行。"""

    source_id: UUID
    point_code: str
    ts: datetime
    value_num: float
    value_text: None
    quality: str


def source_points(settings: Settings) -> PlanClient:
    """用现有采集计划核对点位和归档配置。Args: settings。"""
    return PlanClient(
        base_url=settings.platform_base_url,
        service_key=settings.edge_service_key.get_secret_value(),
        timeout_s=settings.plan_timeout_s,
    )


def read_rows(path: Path, source_id: UUID) -> Iterator[ArchiveRow]:
    """读取规范 CSV，禁止无时区时间和非有限读数。Args: path, source_id。"""
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames != ["point_code", "ts", "value_num"]:
            raise ValueError("CSV 表头应为 point_code,ts,value_num")
        for row in reader:
            timestamp = datetime.fromisoformat(row["ts"])
            value = float(row["value_num"])
            if timestamp.utcoffset() is None or not isfinite(value):
                raise ValueError(
                    f"历史 CSV 第 {reader.line_num} 行的时刻或数值无效"
                )
            yield ArchiveRow(
                source_id=source_id,
                point_code=row["point_code"],
                ts=timestamp,
                value_num=value,
                value_text=None,
                quality="good",
            )


def rows_in_batches(
    path: Path, source_id: UUID, size: int
) -> Iterator[list[ArchiveRow]]:
    """按上限流式拆批，源文件可远大于内存。Args: path, source_id, size。"""
    rows = read_rows(path, source_id)
    while batch := list(islice(rows, size)):
        yield batch


def build_database(settings: Settings) -> Database:
    """按采集服务权限连接归档库。Args: settings。"""
    return Database(
        dsn=settings.dsn(),
        profile=PoolProfile(
            pool_size=1,
            max_overflow=0,
            connect_timeout_s=settings.postgres_connect_timeout_s,
            statement_timeout_ms=settings.postgres_statement_timeout_ms,
            lock_timeout_ms=settings.postgres_lock_timeout_ms,
        ),
        search_path=settings.postgres_schema,
    )


async def run(path: Path, source_id: UUID, *, should_apply: bool) -> None:
    """取得采集计划并导入。Args: path, source_id, should_apply。"""
    settings = load_settings_or_exit(Settings)
    plan = await source_points(settings).fetch()
    await import_history(
        path, source_id, settings, plan, should_apply=should_apply
    )


async def import_history(
    path: Path,
    source_id: UUID,
    settings: Settings,
    plan: CollectPlan,
    *,
    should_apply: bool,
) -> None:
    """预检并追加历史。

    Args: path, source_id, settings, plan, should_apply。
    """
    archived = {
        point.point_code
        for source in plan.sources
        if source.source_id == source_id
        for point in source.points
        if point.archive_enabled and point.data_type in ("float", "int")
    }
    size, requested = await asyncio.to_thread(inspect_file, path, source_id)
    missing = requested - archived
    if missing:
        raise ValueError(
            f"不在已启用归档的采集计划中：{', '.join(sorted(missing))}"
        )
    _logger.info(
        "history_import_planned",
        "点位历史已通过预检",
        row_count=size,
        point_count=len(requested),
    )
    if not should_apply:
        return
    database = build_database(settings)
    try:
        service = PointHistoryService(database=database, batch_rows=5000)
        batches = rows_in_batches(path, source_id, service.batch_rows)
        written = 0
        empty_batch: list[ArchiveRow] = []
        while batch := await asyncio.to_thread(next, batches, empty_batch):
            written += await service.store(batch)
        _logger.info(
            "history_import_finished",
            "点位历史导入完成",
            inserted=written,
            duplicate=size - written,
        )
    finally:
        await database.dispose()


def inspect_file(path: Path, source_id: UUID) -> tuple[int, set[str]]:
    """确认所有行可解码，并收齐实际使用的点位编码。Args: path, source_id。"""
    count = 0
    codes: set[str] = set()
    for row in read_rows(path, source_id):
        count += 1
        codes.add(row["point_code"])
    return count, codes


def main(argv: Sequence[str] | None = None) -> None:
    """解析归档导入命令。Args: argv。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    parser.add_argument("--source-id", type=UUID, required=True)
    parser.add_argument("--apply", action="store_true")
    options = parser.parse_args(argv)
    configure_logging(
        service="collector-server",
        role="archive-import",
        instance="cli",
        level="INFO",
        log_format="json",
    )
    asyncio.run(
        run(options.path, options.source_id, should_apply=options.apply)
    )


if __name__ == "__main__":
    main()
