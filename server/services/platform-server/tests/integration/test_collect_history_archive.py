"""点位历史读侧对着**真库**跑一遍：查得出、翻得动、桶分得开。

⚠ 这一份存在的理由：读侧原来只有「拿假件断言 SQL 文本」的用例，于是
`ts >= :range_start` 绑字符串、`CAST(:bucket_width AS interval)` 绑字符串这两处
全绿地过了闸——而真库上驱动按上下文把这两个占位符认成 timestamptz 与 interval，
喂字符串是当场 DataError，整条读侧恒 503。假件永远看不出这一类，只能对着真库跑。
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from integration.dataset_helpers import ArchiveWriter, Sample
from lib.web import CursorParams, decode_cursor
from platform_server.apps.collect.schemas import AggregateIn
from platform_server.apps.collect.services import (
    ReadOnlyHistorySource,
    history_service,
)

pytestmark = pytest.mark.requires_postgres

POINT_CODE = "outlet_temp"
RANGE_START = datetime(2026, 8, 1, tzinfo=UTC)
RANGE_END = datetime(2026, 8, 1, 1, tzinfo=UTC)


def minute(index: int) -> datetime:
    """区间内第 index 分钟。

    Args: index。
    """
    return RANGE_START + timedelta(minutes=index)


async def seed(archive: ArchiveWriter, count: int) -> str:
    """种 count 条逐分钟读数，回这个点位的 node_key。

    Args: archive, count。
    """
    await archive.write(
        POINT_CODE,
        [Sample(ts=minute(i), value_num=float(i)) for i in range(count)],
    )
    return archive.node_key(POINT_CODE)


def query(node_key: str) -> history_service.HistoryQuery:
    """一条覆盖整段的查询。

    Args: node_key。
    """
    return history_service.build_query(
        node_keys=[node_key],
        range_start=RANGE_START,
        range_end=RANGE_END,
    )


async def test_a_seeded_window_reads_back_from_the_real_archive(
    history_source: ReadOnlyHistorySource, archive: ArchiveWriter
) -> None:
    node_key = await seed(archive, 5)
    page = await history_service.read_history(
        history_source, query=query(node_key), page=CursorParams(50, None)
    )
    assert [item.value for item in page.items] == [0.0, 1.0, 2.0, 3.0, 4.0]
    assert page.has_more is False


async def test_the_cursor_walks_the_window_without_repeats_or_gaps(
    history_source: ReadOnlyHistorySource, archive: ArchiveWriter
) -> None:
    # ⚠ 翻页那一跳单独验：`after_ts` 是第二个只在游标路径上才绑的时刻参数，
    # 首页查得出不蕴含它也查得出
    node_key = await seed(archive, 5)
    seen: list[object] = []
    after: str | None = None
    for _ in range(3):
        page = await history_service.read_history(
            history_source,
            query=query(node_key),
            page=CursorParams(2, after),
        )
        seen.extend(item.value for item in page.items)
        if not page.has_more:
            break
        assert page.next is not None
        after = page.next
    assert seen == [0.0, 1.0, 2.0, 3.0, 4.0]


async def test_the_cursor_anchor_survives_a_sub_millisecond_moment(
    history_source: ReadOnlyHistorySource, archive: ArchiveWriter
) -> None:
    # ⚠ 对外那份 RFC3339 截到毫秒：拿它当锚点的话，这一行会在下一页里再来一次
    await archive.write(
        POINT_CODE,
        [
            Sample(ts=RANGE_START + timedelta(microseconds=1500), value_num=1),
            Sample(ts=RANGE_START + timedelta(seconds=1), value_num=2),
        ],
    )
    node_key = archive.node_key(POINT_CODE)
    first = await history_service.read_history(
        history_source, query=query(node_key), page=CursorParams(1, None)
    )
    assert first.next is not None
    assert decode_cursor(first.next)["ts"] == "2026-08-01T00:00:00.001500+00:00"
    second = await history_service.read_history(
        history_source,
        query=query(node_key),
        page=CursorParams(1, first.next),
    )
    assert [item.value for item in second.items] == [2.0]


async def test_buckets_come_back_from_the_real_time_bucket(
    history_source: ReadOnlyHistorySource, archive: ArchiveWriter
) -> None:
    # ⚠ 聚合那条是第二条绑非文本参数的路径（桶宽是 interval），单独验
    node_key = await seed(archive, 40)
    result = await history_service.aggregate_history(
        history_source,
        payload=AggregateIn(
            node_keys=[node_key],
            range_start=RANGE_START,
            range_end=RANGE_END,
            interval="15m",
            aggregate="avg",
        ),
        default_timezone="UTC",
    )
    assert [item.bucket_start for item in result.items] == [
        RANGE_START,
        minute(15),
        minute(30),
    ]
    assert [item.sample_count for item in result.items] == [15, 15, 10]
    assert result.items[0].value == pytest.approx(7.0)


async def test_a_point_outside_the_asked_window_stays_out(
    history_source: ReadOnlyHistorySource, archive: ArchiveWriter
) -> None:
    # ⚠ 区间真的进了 SQL 才算数：绑参数漏成常量时，这一条会连隔壁一小时一起捞
    await archive.write(
        POINT_CODE,
        [
            Sample(ts=RANGE_START - timedelta(minutes=1), value_num=-1),
            Sample(ts=minute(0), value_num=0),
            Sample(ts=RANGE_END, value_num=99),
        ],
    )
    page = await history_service.read_history(
        history_source,
        query=query(archive.node_key(POINT_CODE)),
        page=CursorParams(50, None),
    )
    assert [item.value for item in page.items] == [0.0]


async def test_an_unknown_point_reads_back_empty_rather_than_failing(
    history_source: ReadOnlyHistorySource,
) -> None:
    node_key = f"{uuid.uuid4()}:{POINT_CODE}"
    page = await history_service.read_history(
        history_source, query=query(node_key), page=CursorParams(50, None)
    )
    assert page.items == []
