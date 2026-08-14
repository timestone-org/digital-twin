"""建表迁移里的字面量与 `domain/timeseries` 的活常量比对。

迁移是**冻结件**：它必须写死字面量，否则同一个 revision 在旧库与新建库会建出
不同的结构，而且没有任何东西会报错。但写死之后两侧就可能各自漂，所以要有这份比对——
它不是拦住「改常量」，而是逼着改的人**同时决定存量库怎么办**（再写一支迁移）。
"""

import importlib.util
from pathlib import Path
from types import ModuleType

from timeseries import (
    CHUNK_INTERVAL,
    HISTORY_COLUMNS,
    HISTORY_TABLE,
    QUALITIES,
    SEGMENT_BY,
)

VERSIONS = Path(__file__).resolve().parents[2] / "migrations" / "versions"


def _load_migration() -> ModuleType:
    """按文件名找到建表那一支并加载它。"""
    matches = sorted(VERSIONS.glob("*add_point_history_hypertable.py"))
    assert len(matches) == 1
    spec = importlib.util.spec_from_file_location("history_ddl", matches[0])
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migration_does_not_import_live_constants() -> None:
    """⚠ 冻结件不许 import 活常量——这条比下面几条都重要。"""
    matches = sorted(VERSIONS.glob("*add_point_history_hypertable.py"))
    source = matches[0].read_text(encoding="utf-8")
    assert "from timeseries import" not in source
    assert "import timeseries" not in source


def test_quality_literals_match_the_domain_constant() -> None:
    """质量位三档两侧一致。"""
    module = _load_migration()
    literals: tuple[str, ...] = module.QUALITY_LITERALS
    assert literals == QUALITIES


def test_table_name_matches_the_domain_constant() -> None:
    """表名两侧一致。"""
    module = _load_migration()
    assert module.TABLE == HISTORY_TABLE


def test_chunk_interval_matches_the_domain_constant() -> None:
    """分块间隔两侧一致。6 小时是实测取值，见 COLLECT_DESIGN.md §6。"""
    module = _load_migration()
    hours = int(CHUNK_INTERVAL.total_seconds() // 3600)
    assert f"{hours} hours" == module.CHUNK_INTERVAL


def test_segment_by_matches_the_domain_constant() -> None:
    """⚠ 段键两侧一致，且 point_code 必须在内：拿掉它按点位删除要解压整段。"""
    module = _load_migration()
    assert ", ".join(SEGMENT_BY) == module.SEGMENT_BY
    assert "point_code" in module.SEGMENT_BY


def test_every_declared_column_is_created() -> None:
    """列契约声明的六列，建表语句里一列不少。"""
    matches = sorted(VERSIONS.glob("*add_point_history_hypertable.py"))
    source = matches[0].read_text(encoding="utf-8")
    for column in HISTORY_COLUMNS:
        assert f'"{column}"' in source or f"'{column}'" in source
