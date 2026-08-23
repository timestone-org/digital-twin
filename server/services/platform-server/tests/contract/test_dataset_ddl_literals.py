"""建表迁移里的字面量与 `apps/dataset` 的活常量比对。

迁移是**冻结件**：它必须写死字面量，否则同一个 revision 在旧库与新建库会建出
不同的结构，而且没有任何东西会报错。但写死之后两侧就可能各自漂，所以要有这份
比对——它不是拦住「改常量」，而是逼着改的人**同时决定存量库怎么办**。
"""

import importlib.util
from pathlib import Path
from types import ModuleType

from sqlalchemy import CheckConstraint

from platform_server.apps.dataset.models import (
    KEY_PATTERN,
    MAX_DECIMALS,
    MAX_FORMULA_LENGTH,
    MAX_INTERVAL_MS,
    MIN_INTERVAL_MS,
    DatasetColumn,
)
from platform_server.apps.dataset.protocols import (
    AGG_FUNCS,
    COLLECT_MODES,
    COLUMN_SOURCES,
    COLUMN_TYPES,
    RECORD_SOURCES,
    sql_values,
)

VERSIONS = Path(__file__).resolve().parents[2] / "migrations" / "versions"
PATTERN = "*add_dataset_tables.py"


def _migration_path() -> Path:
    """按文件名找到建表那一支。"""
    matches = sorted(VERSIONS.glob(PATTERN))
    assert len(matches) == 1
    return matches[0]


def _load_migration() -> ModuleType:
    """把建表那一支当普通模块加载，好读它的字面量。"""
    spec = importlib.util.spec_from_file_location(
        "dataset_ddl", _migration_path()
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migration_does_not_import_live_constants() -> None:
    """⚠ 冻结件不许 import 活常量——这条比下面几条都重要。"""
    source = _migration_path().read_text(encoding="utf-8")
    assert "from platform_server" not in source
    assert "import platform_server" not in source


def test_the_five_closed_sets_match_the_live_literals() -> None:
    """五组取值两侧逐字一致，分叉的表现是写入被数据库拒绝。"""
    module = _load_migration()
    assert sql_values(COLLECT_MODES) == module.COLLECT_MODES
    assert sql_values(COLUMN_SOURCES) == module.COLUMN_SOURCES
    assert sql_values(COLUMN_TYPES) == module.COLUMN_TYPES
    assert sql_values(AGG_FUNCS) == module.AGG_FUNCS
    assert sql_values(RECORD_SOURCES) == module.RECORD_SOURCES


def test_the_numeric_bounds_match_the_live_constants() -> None:
    """周期、公式长度与小数位三处上下界两侧一致。"""
    module = _load_migration()
    assert module.MIN_INTERVAL_MS == MIN_INTERVAL_MS
    assert module.MAX_INTERVAL_MS == MAX_INTERVAL_MS
    assert module.MAX_FORMULA_LENGTH == MAX_FORMULA_LENGTH
    assert module.MAX_DECIMALS == MAX_DECIMALS


def test_the_key_check_is_the_pydantic_pattern_with_doubled_quotes() -> None:
    """⚠ 同一条规则写两遍：SQL 字面量里的单引号要写成两个。

    两边分叉的表现是入参放行而数据库拒绝，或者反过来——入参拒绝而库里早就躺着
    一批带公式记号的 key。
    """
    module = _load_migration()
    assert (
        f"key ~ '{KEY_PATTERN.replace(chr(39), 2 * chr(39))}'"
        == module.KEY_CHECK
    )


def test_the_table_definition_carries_the_same_key_check_as_the_migration() -> (
    None
):
    """表定义上的 CHECK 与迁移建出来的那条必须逐字一样。

    ⚠ 两者漂开是**静默**的：库里的约束由迁移建出，表定义只是元数据，于是运行期
    照常拒绝而读模型的人以为放行，唯一的症状是 autogenerate 想把它改回去。
    """
    module = _load_migration()
    constraints = {
        constraint.name: str(constraint.sqltext)
        for constraint in DatasetColumn.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    }
    # 名字是命名约定展开之后的全名，与迁移里手写的那个一致
    assert (
        constraints["ck_dataset_columns_key_has_no_formula_token"]
        == module.KEY_CHECK
    )


def test_the_hypertable_parameters_are_the_ones_the_design_locked() -> None:
    """⚠ 段键取 table_id：逐表删除于是退化成丢弃整段、零解压。"""
    module = _load_migration()
    assert module.CHUNK_INTERVAL == "7 days"
    assert module.SEGMENT_BY == "table_id"
    assert module.ORDER_BY == "ts DESC"
    assert module.COMPRESS_AFTER == "30 days"


def test_the_hypertable_carries_no_retention_policy() -> None:
    """⚠ 台账默认永久保留（D7）：加了保留策略就是静默删历史，不可逆。"""
    source = _migration_path().read_text(encoding="utf-8")
    assert "add_retention_policy" not in source
