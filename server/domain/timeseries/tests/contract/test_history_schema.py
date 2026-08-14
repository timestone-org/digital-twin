"""锁住宽表列契约：常量与 docs/COLLECT_DESIGN.md §6 的建表 DDL 逐字一致。

列名在这里改了而迁移或查询没跟上，只会读出空结果，不会报错。
"""

from datetime import timedelta

from timeseries.quality import QUALITIES
from timeseries.schema import (
    CHUNK_INTERVAL,
    HISTORY_COLUMNS,
    HISTORY_SCHEMA,
    HISTORY_TABLE,
    PRIMARY_KEY_COLUMNS,
    SEGMENT_BY,
    TIME_COLUMN,
)

DDL_QUALIFIED_TABLE = "collect.point_history"
DDL_COLUMNS = (
    "source_id",
    "point_code",
    "ts",
    "value_num",
    "value_text",
    "quality",
)
DDL_PRIMARY_KEY = "PRIMARY KEY (source_id, point_code, ts)"
DDL_QUALITY_CHECK = "quality IN ('good','uncertain','bad')"
DDL_HYPERTABLE_TIME_COLUMN = "ts"
DDL_CHUNK_TIME_INTERVAL = "interval '6 hours'"
DDL_COMPRESS_SEGMENTBY = "source_id, point_code"


def test_the_table_lives_in_the_collect_schema() -> None:
    assert f"{HISTORY_SCHEMA}.{HISTORY_TABLE}" == DDL_QUALIFIED_TABLE


def test_the_column_tuple_matches_the_ddl_in_order() -> None:
    assert HISTORY_COLUMNS == DDL_COLUMNS


def test_the_primary_key_is_the_natural_composite_key() -> None:
    assert f"PRIMARY KEY ({', '.join(PRIMARY_KEY_COLUMNS)})" == DDL_PRIMARY_KEY


def test_every_key_column_is_a_column_of_the_table() -> None:
    assert set(PRIMARY_KEY_COLUMNS) <= set(HISTORY_COLUMNS)


def test_the_partition_column_is_the_timestamp() -> None:
    assert TIME_COLUMN == DDL_HYPERTABLE_TIME_COLUMN
    assert TIME_COLUMN in HISTORY_COLUMNS


def test_chunks_span_six_hours() -> None:
    # 1 天的块超内存预算 4.59×，6 小时同时给出最好的压缩比（实测）
    hours = CHUNK_INTERVAL // timedelta(hours=1)
    assert f"interval '{hours} hours'" == DDL_CHUNK_TIME_INTERVAL


def test_the_segment_key_keeps_point_code() -> None:
    # ⚠ 从段键里拿掉 point_code，按点位删除就退化成解压整段
    assert ", ".join(SEGMENT_BY) == DDL_COMPRESS_SEGMENTBY


def test_the_segment_key_columns_belong_to_the_table() -> None:
    assert set(SEGMENT_BY) <= set(HISTORY_COLUMNS)


def test_the_quality_grades_match_the_check_constraint() -> None:
    values = ",".join(f"'{grade}'" for grade in QUALITIES)
    assert f"quality IN ({values})" == DDL_QUALITY_CHECK
