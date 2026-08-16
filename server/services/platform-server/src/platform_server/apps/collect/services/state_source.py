"""数据源的采集运行态读侧：collector 写、platform 只读（ADR-0003）。

配置面只知道「配了什么」，连没连上、为什么没连上只有采集运行时知道。没有这
一步，界面就只能摆出一个「已启用」而说不出它到底有没有在采——而那两件事在
现场差别极大。

⚠ 跨 schema **只读**：`collect` 归 collector-server 写独占，走归档那条独立
只读连接池 + `SET TRANSACTION READ ONLY`，不 JOIN、不建外键、不共用事务。
⚠ 表名与列名的唯一真源是 `collectwire`，写侧的 ORM 模型用的是同一份
（ADR-0017）——跨 schema 仍然不共享 ORM 模型，共享的只是名字。
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from collectwire import (
    ERROR_CATEGORY_COLUMN,
    ERROR_DETAIL_COLUMN,
    LEADER_COLUMN,
    POINT_COUNT_COLUMN,
    SOURCE_COLUMN,
    STATE_COLUMN,
    STATE_COLUMNS,
    STATE_TABLE_NAME,
    STATE_UNKNOWN,
    STATES,
    UPDATED_COLUMN,
)
from lib.logging import get_logger
from platform_server.apps.collect.crud import HistorySource
from platform_server.apps.collect.errors import HistoryUnavailable
from timeseries import HISTORY_SCHEMA

_logger = get_logger("platform.collect.state")

# schema 前缀在这一侧补：共享口径只给表名，schema 是各服务自己的配置
STATE_TABLE = f"{HISTORY_SCHEMA}.{STATE_TABLE_NAME}"

# 抑制 S608 的理由 —— 拼进 SQL 的只有共享口径里的表名与列名常量，唯一的
# 外部输入是 `:source_ids` 绑定参数
_SELECT = (
    f"SELECT {', '.join(STATE_COLUMNS)}"  # noqa: S608
    f" FROM {STATE_TABLE}"
    f" WHERE {SOURCE_COLUMN} = ANY(:source_ids)"
)


@dataclass(frozen=True)
class SourceRuntime:
    """一个数据源此刻的采集运行态。"""

    state: str
    point_count: int
    error_category: str | None
    error_detail: str | None
    leader_instance: str | None
    updated_at: datetime | None


# 采集侧还没写过这一行时给出的运行态。⚠ 不返回 None：让界面拿到一个说得出
# 「还不知道」的对象，比让它自己拿 null 编一句话可靠
UNKNOWN = SourceRuntime(
    state=STATE_UNKNOWN,
    point_count=0,
    error_category=None,
    error_detail=None,
    leader_instance=None,
    updated_at=None,
)


@dataclass(frozen=True)
class SourceStateSource:
    """按数据源批量读运行态。"""

    history: HistorySource

    async def read(
        self, source_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, SourceRuntime]:
        """取一批数据源的运行态。采集侧没写过的**不出现在结果里**。

        ⚠ 读不到不许把整页请求打挂：运行态是配置页的旁路信息，collector 没
        起来时配置本身照样要能看、能改。故这里吞掉依赖异常并返回空表，调用
        方按 `UNKNOWN` 兜底。
        Args: source_ids。
        """
        if not source_ids:
            return {}
        try:
            rows = await self.history.fetch_all(
                _SELECT, {"source_ids": [str(item) for item in source_ids]}
            )
        except HistoryUnavailable as error:
            _logger.warning(
                "collect_state_read_failed",
                "读采集运行态失败，本次按「还不知道」显示",
                error_type=type(error).__name__,
            )
            return {}
        return decode_rows(rows)


def decode_rows(
    rows: Sequence[Mapping[str, object]],
) -> dict[uuid.UUID, SourceRuntime]:
    """把结果行解成运行态表，认不出的行一律跳过。

    Args: rows。
    """
    found: dict[uuid.UUID, SourceRuntime] = {}
    for row in rows:
        source_id = _uuid_of(row.get(SOURCE_COLUMN))
        if source_id is None:
            continue
        found[source_id] = _runtime_of(row)
    return found


def _runtime_of(row: Mapping[str, object]) -> SourceRuntime:
    updated_at = row.get(UPDATED_COLUMN)
    return SourceRuntime(
        state=_state_of(row.get(STATE_COLUMN)),
        point_count=_int_of(row.get(POINT_COUNT_COLUMN)),
        error_category=_text_of(row.get(ERROR_CATEGORY_COLUMN)),
        error_detail=_text_of(row.get(ERROR_DETAIL_COLUMN)),
        leader_instance=_text_of(row.get(LEADER_COLUMN)),
        updated_at=updated_at if isinstance(updated_at, datetime) else None,
    )


def _state_of(value: object) -> str:
    """把库里的取值收窄成闭合集合，越界一律当成「还不知道」。

    ⚠ 只有绕过 CHECK 直接改库才会走到这里；原样透出会让界面按一个它不认识
    的分支渲染，而那比显示「还不知道」更难查。
    Args: value。
    """
    if isinstance(value, str) and value in STATES:
        return value
    return STATE_UNKNOWN


def _uuid_of(value: object) -> uuid.UUID | None:
    if isinstance(value, uuid.UUID):
        return value
    if not isinstance(value, str):
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


def _int_of(value: object) -> int:
    return value if isinstance(value, int) else 0


def _text_of(value: object) -> str | None:
    return value if isinstance(value, str) else None
