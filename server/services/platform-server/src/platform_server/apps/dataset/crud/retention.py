"""保留期清理的数据访问：删一段过期台账行、找最老的一行、回收死索引页。

三条硬约束全写在这里，因为它们都是**语句形态**上的约束——离开这几条 SQL 就
无从谈起（docs/DATASET_DESIGN.md §15.2）。三条都是在真库上量出来的：

a. **谓词里绝不许出现子查询**。压缩超表上 `… IN (SELECT …)` 实测跑了 5.5 秒，
   然后以 `tuple decompression limit exceeded` 收场。要删哪几张表先 SELECT 进
   应用层，再当绑定参数下发。推论是**批的单位是「哪张表、多宽的 ts 窗口」而
   不是「多少行」**——PostgreSQL 的 DELETE 没有 LIMIT。
b. **`ts` 必须同时给上界与下界**。只给一侧，计划器会扫遍每一个 chunk。
c. **必须周期性 REINDEX**。压缩 chunk 上的 DML 让 `index_bytes` 涨了 29 倍，
   而 `VACUUM (ANALYZE)` 一个字节都收不回来（387MB → 393MB）；只有 REINDEX
   收得回（单个 chunk 23ms，回收 112MB）。

⚠ 绑定参数后面绝不能紧跟 `::` 转型：那会破坏 `text()` 的参数解析。类型一律由
`bindparams` 声明，让方言自己渲染。
"""

import re
import uuid
from datetime import datetime
from typing import Any, cast

from sqlalchemy import CursorResult, DateTime, bindparam, select, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.models import DatasetRecord
from platform_server.settings import DB_SCHEMA

# 完全限定的表名。⚠ 不靠 search_path：连接万一没设对，未限定的表名会静默命中
# 另一个 schema 里的同名表
RECORDS_TABLE = f"{DB_SCHEMA}.{DatasetRecord.__tablename__}"

# timescaledb 扩展所在的 schema。⚠ 与 `container.TIMESCALE_SCHEMA` 同值（两边
# 一致由用例钉着）：本模块用的是业务写连接，它的 search_path 只指向 platform，
# `show_chunks` 不写全限定就解析不到——而报出来的是「function show_chunks(…)
# does not exist」，一句看起来像版本不对、其实是路径不对的错
TIMESCALE_SCHEMA = "public"

# REINDEX 等锁的上限。⚠ 拿不到就跳过这个 chunk：回收索引远没有「别把写入堵死」
# 要紧
REINDEX_LOCK_TIMEOUT = "5s"

# chunk 名的形状白名单。DDL 的标识符位置无法参数化，只能拼串，故先验形状
CHUNK_NAME = re.compile(r'^[A-Za-z0-9_."$]+$')

# 一批 DELETE：**纯字面量谓词**，无 SELECT / JOIN / 子查询（约束 a），且 `ts`
# 上下界俱全（约束 b）。⚠ 公开而不是加下划线：这两条的**形状**是硬约束，由
# tests/contract/test_dataset_retention_sql.py 逐条钉着
DELETE_SQL = text(f"""
    DELETE FROM {RECORDS_TABLE}
     WHERE table_id = :table_id
       AND ts >= :from_ts
       AND ts < :to_ts
    """).bindparams(  # noqa: S608 —— 表名是本模块的常量，谓词里全是绑定参数
    bindparam("table_id", type_=UUID(as_uuid=True)),
    bindparam("from_ts", type_=DateTime(timezone=True)),
    bindparam("to_ts", type_=DateTime(timezone=True)),
)

# 受这一趟影响的 chunk（约束 c 的 REINDEX 对象）。`show_chunks` 是元数据查询，
# 不碰数据页，与约束 a 无关——约束 a 管的是 DELETE 的谓词形态
CHUNKS_SQL = text(f"""
    SELECT {TIMESCALE_SCHEMA}.show_chunks(
             '{RECORDS_TABLE}',
             older_than => :older_than,
             newer_than => :newer_than
           )::text AS chunk_name
    """).bindparams(
    bindparam("older_than", type_=DateTime(timezone=True)),
    bindparam("newer_than", type_=DateTime(timezone=True)),
)


async def delete_window(
    session: AsyncSession,
    *,
    table_id: uuid.UUID,
    from_ts: datetime,
    to_ts: datetime,
) -> int:
    """删掉一张台账在 `[from_ts, to_ts)` 里的行，返回实删行数。

    Args: session, table_id, from_ts, to_ts。
    """
    result = await session.execute(
        DELETE_SQL.bindparams(table_id=table_id, from_ts=from_ts, to_ts=to_ts)
    )
    # cast 的理由 —— DML 的 execute 运行期返回 CursorResult，而 AsyncSession
    # 的静态签名只承诺 Result，`rowcount` 在后者上不存在
    return max(0, cast("CursorResult[Any]", result).rowcount)


async def oldest_ts(
    session: AsyncSession, table_id: uuid.UUID
) -> datetime | None:
    """一张台账最老那一行的 `ts`；一行都没有给 None。

    ⚠ 用 `ORDER BY ts LIMIT 1` 而不是 `min(ts)`：前者走超表的有序追加计划，
    摸一个 chunk 就回来；后者是一次跨全部 chunk 的扫描。它给的是删除窗口的
    下界——约束 b 要求下界必须存在。
    Args: session, table_id。
    """
    rows = await session.execute(
        select(DatasetRecord.ts)
        .where(DatasetRecord.table_id == table_id)
        .order_by(DatasetRecord.ts.asc())
        .limit(1)
    )
    return rows.scalars().first()


async def chunks_in_span(
    session: AsyncSession, *, since: datetime, until: datetime
) -> list[str]:
    """`[since, until)` 覆盖到的 chunk 名，按 PG 自己给的顺序。

    Args: session, since, until。
    """
    rows = await session.execute(
        CHUNKS_SQL.bindparams(older_than=until, newer_than=since)
    )
    return [str(row.chunk_name) for row in rows.all() if row.chunk_name]


async def reindex_chunk(session: AsyncSession, name: str) -> None:
    """对一个 chunk 跑 `REINDEX TABLE`，等锁不超过 `REINDEX_LOCK_TIMEOUT`。

    ⚠ 它拿的是 ACCESS EXCLUSIVE 锁。等锁超时会抛，调用方必须**吞掉**：为了
    回收索引把归档写入堵死，是拿一件要紧的事去换一件不要紧的事。
    ⚠ `name` 必须先过 `CHUNK_NAME` 的形状白名单：DDL 的标识符位置无法参数化，
    这里只能拼串。
    Args: session, name。
    """
    await session.execute(
        text(f"SET LOCAL lock_timeout = '{REINDEX_LOCK_TIMEOUT}'")
    )
    await session.execute(text(f"REINDEX TABLE {name}"))
