"""台账行的数据访问。删表时的清行也在这里——超表上没有外键可以级联。

⚠ 凡是按行取的查询都尽量带上 `ts`：它是分区列，带上直接命中 chunk，不带就是
跨 chunk 扫描（docs/DATASET_DESIGN.md §6.1）。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import (
    Select,
    delete,
    func,
    select,
    text,
    tuple_,
)
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.dataset.models import DatasetRecord
from platform_server.settings import DB_SCHEMA

# 反扫的排序：最新在前。⚠ 第二键不能省——同一个 ts 上可以有多行（人工补录与
# 采集各一行），只按 ts 排时两次翻页会重复或漏掉其中一行
NEWEST_FIRST = (DatasetRecord.ts.desc(), DatasetRecord.row_id.desc())
OLDEST_FIRST = (DatasetRecord.ts.asc(), DatasetRecord.row_id.asc())

# 整列聚合的底数：`*_ALL` 五个函数共用这一次扫描。
# ⚠ 三层取值（computed → overrides.v → values）就是 SQL 版的 effective 口径，
# 与 `services/effective.py` 的一致性由单元测试钉住（§4.3a）。
# ⚠ 公式层用 `-> IS NOT NULL` 判在场而不是让 COALESCE 跳过：算出来是空的公式列
# 仍以公式为准，COALESCE 会让 `values_json` 里的旧值借尸还魂。
# ⚠ 列 key 用 `unnest` 横向展开，一条语句算完全部列——每列一条 SQL 就是 N 遍
# 全表顺序扫描。
_NUMERIC_TEXT = r"^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$"
# 理由：拼进这段 SQL 的只有本模块的两个常量（数字判别正则与 schema 名），
# 全部外部输入——列 key、台账 id、要排除的行——一律走绑定参数
_WHOLE_STATS_SELECT = f"""
SELECT ckey,
       min(numeric_value) AS min_value,
       max(numeric_value) AS max_value,
       sum(numeric_value) AS sum_value,
       count(numeric_value) AS value_count
FROM (
    SELECT ckey,
           CASE WHEN cell ~ '{_NUMERIC_TEXT}' THEN cell::float8 END
               AS numeric_value
    FROM {DB_SCHEMA}.dataset_records AS r
    CROSS JOIN unnest(CAST(:keys AS text[])) AS ckey
    CROSS JOIN LATERAL (
        SELECT CASE
            WHEN r.computed_json -> ckey IS NOT NULL
                THEN r.computed_json ->> ckey
            WHEN r.overrides_json -> ckey -> 'v' IS NOT NULL
                THEN r.overrides_json -> ckey ->> 'v'
            ELSE r.values_json ->> ckey
        END AS cell
    ) AS picked
    WHERE r.table_id = CAST(:table_id AS uuid)"""  # noqa: S608
_WHOLE_STATS_TAIL = """
) AS cells
GROUP BY ckey
"""
_EXCLUDE_ROW = "\n      AND r.row_id <> CAST(:exclude_row_id AS uuid)"


@dataclass(frozen=True)
class WholeStatsRow:
    """一列在整表上的四个可加底数。五个 `*_ALL` 全由它们导出。"""

    minimum: float | None
    maximum: float | None
    total: float | None
    count: int


@dataclass(frozen=True)
class RecordWindow:
    """一次行扫描的边界。

    ⚠ 上下界分成闭区间（`since` / `until`）与开区间（`after` / `before`）两对，
    不合并成一对：时间窗是 `(下界, ts]`、`PREV` 是 `ts < 当前`，而记录列表要的
    是闭区间。差一行不会报错，只会让 `SUM_OVER` 静默多算或少算一条。
    """

    table_id: uuid.UUID
    since: datetime | None = None
    until: datetime | None = None
    after: datetime | None = None
    before: datetime | None = None
    exclude_row_id: uuid.UUID | None = None
    #: 只要有人工修正的行。批量撤销只需要它们，全扫是白扫
    has_overrides: bool = False
    #: 倒序键集翻页的锚点：`(ts, row_id) < 锚点`。⚠ 两个键都要——同一个 ts 上
    #: 可以有多行，只锚 ts 会在翻页时重复或漏掉其中一行
    after_key: tuple[datetime, uuid.UUID] | None = None

    def narrow(
        self, statement: Select[tuple[DatasetRecord]]
    ) -> Select[tuple[DatasetRecord]]:
        """把边界叠到一条查询上。

        ⚠ 每条谓词都在判空之后才构造：SQLAlchemy 的比较运算符碰上 `None`
        当场抛 `ArgumentError`，先建再挑是在建的时候就炸。
        Args: statement。
        """
        statement = statement.where(DatasetRecord.table_id == self.table_id)
        if self.since is not None:
            statement = statement.where(DatasetRecord.ts >= self.since)
        if self.until is not None:
            statement = statement.where(DatasetRecord.ts <= self.until)
        if self.after is not None:
            statement = statement.where(DatasetRecord.ts > self.after)
        if self.before is not None:
            statement = statement.where(DatasetRecord.ts < self.before)
        if self.exclude_row_id is not None:
            statement = statement.where(
                DatasetRecord.row_id != self.exclude_row_id
            )
        if self.has_overrides:
            statement = statement.where(
                DatasetRecord.overrides_json.isnot(None)
            )
        if self.after_key is not None:
            statement = statement.where(
                tuple_(DatasetRecord.ts, DatasetRecord.row_id) < self.after_key
            )
        return statement


class RecordCrud(CrudBase[DatasetRecord]):
    """`dataset_records` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(DatasetRecord)

    async def count_by_table(
        self, session: AsyncSession, table_id: uuid.UUID
    ) -> int:
        """一张台账下有多少行。

        Args: session, table_id。
        """
        rows = await session.execute(
            select(func.count())
            .select_from(DatasetRecord)
            .where(DatasetRecord.table_id == table_id)
        )
        return int(rows.scalar_one())

    async def delete_by_table(
        self, session: AsyncSession, table_id: uuid.UUID
    ) -> None:
        """删掉一张台账的全部行。

        ⚠ 超表上没有指向 `dataset_tables` 的外键，删表不会级联，必须显式清行；
        不清就是一批永远查不到、也永远删不掉的孤儿行（§4.2）。
        Args: session, table_id。
        """
        await session.execute(
            delete(DatasetRecord).where(DatasetRecord.table_id == table_id)
        )

    async def get_one(
        self,
        session: AsyncSession,
        *,
        table_id: uuid.UUID,
        row_id: uuid.UUID,
        ts: datetime | None,
    ) -> DatasetRecord | None:
        """按行标识取一行。给了 `ts` 就直接命中分区。

        Args: session, table_id, row_id, ts。
        """
        statement = select(DatasetRecord).where(
            DatasetRecord.table_id == table_id,
            DatasetRecord.row_id == row_id,
        )
        if ts is not None:
            statement = statement.where(DatasetRecord.ts == ts)
        rows = await session.execute(statement.limit(1))
        return rows.scalars().first()

    async def latest(
        self, session: AsyncSession, table_id: uuid.UUID
    ) -> DatasetRecord | None:
        """最后一行。主键反扫一行就够。

        Args: session, table_id。
        """
        rows = await session.execute(
            select(DatasetRecord)
            .where(DatasetRecord.table_id == table_id)
            .order_by(*NEWEST_FIRST)
            .limit(1)
        )
        return rows.scalars().first()

    async def scan_newest(
        self, session: AsyncSession, *, window: RecordWindow, limit: int
    ) -> list[DatasetRecord]:
        """按时间窗反扫，取最新的 `limit + 1` 行。

        ★ 这是 `:series` 与任何窗口扫描**共用的那一份**取数：多取的那一行只用来
        判断有没有触顶。调用方拿到的是 **ts 倒序**，要正序自己反转。
        Args: session, window, limit。
        """
        rows = await session.execute(
            window.narrow(select(DatasetRecord))
            .order_by(*NEWEST_FIRST)
            .limit(limit + 1)
        )
        return list(rows.scalars().all())

    async def scan_oldest(
        self, session: AsyncSession, *, window: RecordWindow, limit: int
    ) -> list[DatasetRecord]:
        """按时间窗正扫，取最早的 `limit + 1` 行。

        重算与批量撤销要从最早的一行往后推，故与 `scan_newest` 反向。
        Args: session, window, limit。
        """
        rows = await session.execute(
            window.narrow(select(DatasetRecord))
            .order_by(*OLDEST_FIRST)
            .limit(limit + 1)
        )
        return list(rows.scalars().all())

    async def has_rows_after(
        self, session: AsyncSession, *, table_id: uuid.UUID, ts: datetime
    ) -> bool:
        """这一刻之后还有没有别的行。

        ⚠ 判「下游过期」用的就是它：改一行历史会让它之后那些行的 `PREV` /
        时间窗结果失真（§5.10）。
        Args: session, table_id, ts。
        """
        rows = await session.execute(
            select(DatasetRecord.row_id)
            .where(DatasetRecord.table_id == table_id, DatasetRecord.ts > ts)
            .limit(1)
        )
        return rows.first() is not None

    async def has_other_rows(
        self, session: AsyncSession, *, table_id: uuid.UUID, row_id: uuid.UUID
    ) -> bool:
        """除了这一行，表里还有没有别的行。

        ⚠ 整表聚合（`*_ALL`）过期不能只看「之后」：改一行会改掉整列的
        min/max/sum，比它更早的行同样不准了。
        Args: session, table_id, row_id。
        """
        rows = await session.execute(
            select(DatasetRecord.row_id)
            .where(
                DatasetRecord.table_id == table_id,
                DatasetRecord.row_id != row_id,
            )
            .limit(1)
        )
        return rows.first() is not None

    async def list_before(
        self,
        session: AsyncSession,
        *,
        window: RecordWindow,
        limit: int,
    ) -> list[DatasetRecord]:
        """窗口内最靠后的若干行，按 ts **降序**（`PREV` 要的就是这个序）。

        Args: session, window, limit。
        """
        rows = await session.execute(
            window.narrow(select(DatasetRecord))
            .order_by(*NEWEST_FIRST)
            .limit(limit)
        )
        return list(rows.scalars().all())

    async def list_ascending(
        self, session: AsyncSession, *, window: RecordWindow
    ) -> list[DatasetRecord]:
        """窗口内的全部行，按 ts 升序。时间窗聚合与跨表 as-of 取值要它。

        Args: session, window。
        """
        rows = await session.execute(
            window.narrow(select(DatasetRecord)).order_by(*OLDEST_FIRST)
        )
        return list(rows.scalars().all())

    async def whole_stats(
        self,
        session: AsyncSession,
        *,
        table_id: uuid.UUID,
        keys: Sequence[str],
        exclude_row_id: uuid.UUID | None = None,
    ) -> dict[str, WholeStatsRow]:
        """若干列在整表上的聚合底数，一次扫描算完全部列。

        Args: session, table_id, keys, exclude_row_id（编辑既有行时排除库里
            那份旧值——不排就是拿旧值和新值各算一遍）。
        """
        if not keys:
            return {}
        statement = _WHOLE_STATS_SELECT
        params: dict[str, object] = {
            "keys": sorted(keys),
            "table_id": str(table_id),
        }
        if exclude_row_id is not None:
            statement += _EXCLUDE_ROW
            params["exclude_row_id"] = str(exclude_row_id)
        rows = await session.execute(
            text(statement + _WHOLE_STATS_TAIL), params
        )
        return {
            str(row.ckey): WholeStatsRow(
                minimum=row.min_value,
                maximum=row.max_value,
                total=row.sum_value,
                count=int(row.value_count or 0),
            )
            for row in rows.all()
        }

    async def delete_one(
        self, session: AsyncSession, record: DatasetRecord
    ) -> None:
        """删一行。

        ⚠ 走 DELETE 语句而不是 `session.delete`：主键含分区列 `ts`，条件里
        必须带上它才命中 chunk。
        Args: session, record。
        """
        await session.execute(
            delete(DatasetRecord).where(
                DatasetRecord.table_id == record.table_id,
                DatasetRecord.ts == record.ts,
                DatasetRecord.row_id == record.row_id,
            )
        )


record_crud = RecordCrud()
