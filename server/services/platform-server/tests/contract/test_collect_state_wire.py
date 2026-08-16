"""采集运行态表的口径两侧比对：collector 写、平台读。

跨 schema 读不许共享 ORM 模型（ADR-0003），所以表名、列名与状态取值在两个
服务里各写一份。⚠ 漂了不会报错，只会让配置页上每个数据源都显示「还不知道」
——而那与「collector 真的没起来」长得一模一样。
"""

from pathlib import Path

from platform_server.apps.collect.services.state_source import (
    ERROR_CATEGORY_COLUMN,
    ERROR_DETAIL_COLUMN,
    LEADER_COLUMN,
    POINT_COUNT_COLUMN,
    SOURCE_COLUMN,
    STATE_COLUMN,
    STATE_TABLE,
    STATES,
    UPDATED_COLUMN,
)
from timeseries import HISTORY_SCHEMA

ROOT = Path(__file__).resolve().parents[5]
COLLECTOR = (
    ROOT
    / "server"
    / "services"
    / "collector-server"
    / "src"
    / "collector_server"
)
STATE_MODEL = COLLECTOR / "apps" / "collect" / "models" / "source_state.py"

READ_COLUMNS = (
    SOURCE_COLUMN,
    STATE_COLUMN,
    POINT_COUNT_COLUMN,
    ERROR_CATEGORY_COLUMN,
    ERROR_DETAIL_COLUMN,
    LEADER_COLUMN,
)


def declared() -> str:
    """collector 那边的运行态模型源码。"""
    return STATE_MODEL.read_text(encoding="utf-8")


def test_the_table_is_the_one_the_collector_writes() -> None:
    assert '__tablename__ = "collect_source_states"' in declared()
    assert f"{HISTORY_SCHEMA}.collect_source_states" == STATE_TABLE


def test_every_column_we_read_is_one_the_collector_declares() -> None:
    written = declared()
    assert all(f"{column}: Mapped" in written for column in READ_COLUMNS)


def test_the_timestamp_column_comes_from_the_shared_mixin() -> None:
    # `updated_at` 不在模型里逐字声明，它由 lib 的 TimestampMixin 带进来
    assert "TimestampMixin" in declared()
    assert UPDATED_COLUMN == "updated_at"


def test_the_states_are_the_ones_the_collector_can_write() -> None:
    # ⚠ 少认一个取值，那个状态会被显示成「还不知道」而不是它本来的样子
    written = declared()
    assert all(f'"{state}"' in written for state in STATES)
