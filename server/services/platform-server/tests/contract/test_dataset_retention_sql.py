"""保留期清理那两条 SQL 的**形状**契约。

三条硬约束都是在真库上量出来的，而它们全都长在语句形态上——违反了不会报错，
只会在某个压缩块上跑成 5.5 秒然后抛一句 `tuple decompression limit exceeded`，
或者悄悄扫遍每一个 chunk。故这一组钉的是文本本身
（docs/DATASET_DESIGN.md §15.2）。
"""

import re

from platform_server.apps.dataset.crud import retention as retention_crud
from platform_server.container import TIMESCALE_SCHEMA

DELETE_TEXT = str(retention_crud.DELETE_SQL)
CHUNKS_TEXT = str(retention_crud.CHUNKS_SQL)


def test_the_delete_predicate_has_no_subquery_at_all() -> None:
    # ⚠ 约束 a：压缩超表上 `… IN (SELECT …)` 实测 5.5 秒之后仍以
    # `tuple decompression limit exceeded` 收场。要删哪几张表必须先查进应用层
    assert "SELECT" not in DELETE_TEXT.upper()
    assert "JOIN" not in DELETE_TEXT.upper()
    assert "(" not in DELETE_TEXT


def test_the_delete_predicate_carries_both_ts_bounds() -> None:
    # ⚠ 约束 b：只给一侧的话计划器会扫遍每一个 chunk
    assert re.search(r"ts\s*>=\s*:from_ts", DELETE_TEXT) is not None
    assert re.search(r"ts\s*<\s*:to_ts", DELETE_TEXT) is not None


def test_the_delete_is_pinned_to_one_table_by_a_bound_parameter() -> None:
    # 表标识是绑定参数而不是拼进去的字面量：拼串既是注入面，也让计划缓存失效
    assert ":table_id" in DELETE_TEXT
    assert set(retention_crud.DELETE_SQL._bindparams) == {
        "table_id",
        "from_ts",
        "to_ts",
    }


def test_both_statements_name_the_table_fully_qualified() -> None:
    # ⚠ 不靠 search_path：配错时要的是「表不存在」，不是静默命中另一个 schema
    # 里的同名表
    assert retention_crud.RECORDS_TABLE == "platform.dataset_records"
    prefix = f"DELETE FROM {retention_crud.RECORDS_TABLE}"  # noqa: S608
    assert prefix in DELETE_TEXT
    assert f"'{retention_crud.RECORDS_TABLE}'" in CHUNKS_TEXT


def test_show_chunks_is_reached_through_the_timescale_schema() -> None:
    # ⚠ 业务写连接的 search_path 只有 platform，`show_chunks` 不写全限定就解析
    # 不到，而报出来的是「function show_chunks(…) does not exist」——一句看着
    # 像版本不对、其实是路径不对的错
    assert retention_crud.TIMESCALE_SCHEMA == TIMESCALE_SCHEMA
    assert f"{TIMESCALE_SCHEMA}.show_chunks(" in CHUNKS_TEXT


def test_the_chunk_listing_is_bounded_on_both_sides_too() -> None:
    assert ":older_than" in CHUNKS_TEXT
    assert ":newer_than" in CHUNKS_TEXT


def test_the_chunk_name_whitelist_rejects_what_could_be_injected() -> None:
    # chunk 名要拼进 DDL（标识符位置无法参数化），故先验形状
    assert retention_crud.CHUNK_NAME.match("_timescaledb_internal._hyper_5_2")
    assert retention_crud.CHUNK_NAME.match('"weird$name"')
    assert not retention_crud.CHUNK_NAME.match("chunk; DROP TABLE x")
    assert not retention_crud.CHUNK_NAME.match("chunk name")
    assert not retention_crud.CHUNK_NAME.match("chunk--")


def test_the_reindex_waits_for_the_lock_only_briefly() -> None:
    # ⚠ `REINDEX TABLE` 拿的是 ACCESS EXCLUSIVE 锁：等锁没有上限就是把写入
    # 堵死，而回收索引远没有那件事要紧
    assert retention_crud.REINDEX_LOCK_TIMEOUT.endswith("s")
    assert int(retention_crud.REINDEX_LOCK_TIMEOUT.removesuffix("s")) <= 10
