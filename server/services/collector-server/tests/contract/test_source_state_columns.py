"""守运行态表的实际列名与共享口径一致。

⚠ ORM 的列名是从**属性名**推出来的，两侧 import 同一份常量并**拦不住**属性
改名——改了名，读侧那条按共享列名拼出来的 SELECT 会在库里找不到列，而配置页
上的现象只是每个数据源都显示「还不知道」，与「采集进程没起来」分不开。
这条用例是那个缺口唯一的守卫，靠反射比对，不读对方源码。
"""

from sqlalchemy import CheckConstraint

from collector_server.apps.collect.models.source_state import SourceState
from collectwire import (
    ERROR_CATEGORIES,
    STATE_COLUMNS,
    STATE_TABLE_NAME,
    STATES,
)


def _columns() -> tuple[str, ...]:
    return tuple(column.key for column in SourceState.__table__.columns)


def _check_sql() -> str:
    """全部 CHECK 约束的 SQL 文本拼一起。"""
    return " ".join(
        str(constraint.sqltext)
        for constraint in SourceState.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    )


def test_the_table_name_is_the_shared_one() -> None:
    assert SourceState.__tablename__ == STATE_TABLE_NAME


def test_every_shared_column_exists_on_the_model() -> None:
    """⚠ `updated_at` 不在模型里逐字声明，它由 lib 的 TimestampMixin 带进来。"""
    assert set(STATE_COLUMNS) <= set(_columns())


def test_the_model_declares_no_column_the_reader_cannot_see() -> None:
    """写侧多一列而读侧不认识，那一列就是没人读的死数据。

    `created_at` 是例外：它由 TimestampMixin 带进来，读侧只关心最后一次更新。
    """
    assert set(_columns()) - set(STATE_COLUMNS) == {"created_at"}


def test_the_state_check_constraint_lists_the_shared_states() -> None:
    """库里的取值集合与共享口径同源，越界的行根本写不进去。"""
    text = _check_sql()
    assert all(f"'{state}'" in text for state in STATES)


def test_the_category_check_constraint_lists_the_shared_categories() -> None:
    text = _check_sql()
    assert all(f"'{item}'" in text for item in ERROR_CATEGORIES)
