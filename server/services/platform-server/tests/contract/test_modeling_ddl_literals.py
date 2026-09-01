"""建表迁移里的字面量与 `apps/modeling` 的活常量比对。

迁移是**冻结件**：它必须写死字面量，否则同一个 revision 在旧库与新建库会建出
不同的结构，而且没有任何东西会报错。但写死之后两侧就可能各自漂，所以要有这份
比对——它不是拦住「改常量」，而是逼着改的人**同时决定存量库怎么办**。
"""

import importlib.util
from pathlib import Path
from types import ModuleType

from platform_server.apps.modeling.operators import SERVING_CHANNELS as OPS
from platform_server.apps.modeling.protocols import (
    ACTIVE_RUN_STATUSES,
    MODEL_TASKS,
    NODE_RUN_STATUSES,
    RUN_STATUSES,
    RUN_TRIGGERS,
    SERVING_CHANNELS,
    sql_values,
)

VERSIONS = Path(__file__).resolve().parents[2] / "migrations" / "versions"
PATTERN = "*add_modeling_tables.py"


def _migration() -> ModuleType:
    """把建表那一支迁移当普通模块加载，好读它的字面量。"""
    matches = sorted(VERSIONS.glob(PATTERN))
    assert len(matches) == 1
    spec = importlib.util.spec_from_file_location("modeling_ddl", matches[0])
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_run_statuses_match() -> None:
    """运行状态集合两侧逐字相等。"""
    assert sql_values(RUN_STATUSES) == _migration().RUN_STATUSES


def test_active_run_statuses_match() -> None:
    """在途三格两侧相等。

    ⚠ 这一组是单飞那条部分唯一索引的 WHERE 子句：漂了之后，某个状态会悄悄
    落在索引之外，同一条流水线就能同时跑两次。
    """
    assert sql_values(ACTIVE_RUN_STATUSES) == _migration().ACTIVE_RUN_STATUSES


def test_node_run_statuses_match() -> None:
    """节点状态集合两侧相等（比运行多一格 `skipped`）。"""
    assert sql_values(NODE_RUN_STATUSES) == _migration().NODE_RUN_STATUSES


def test_run_triggers_match() -> None:
    """触发来源两侧相等。"""
    assert sql_values(RUN_TRIGGERS) == _migration().RUN_TRIGGERS


def test_model_tasks_match() -> None:
    """任务类型两侧相等。"""
    assert sql_values(MODEL_TASKS) == _migration().MODEL_TASKS


def test_serving_channels_match_the_migration() -> None:
    """可服务通道与迁移相等。"""
    assert sql_values(SERVING_CHANNELS) == _migration().SERVING_CHANNELS


def test_serving_channels_match_the_operator_contract() -> None:
    """可服务通道与**算子契约**里那份同集合。

    ⚠ 两侧漂了的现象是「算子说自己走 binary、库把这一行的 CHECK 拒了」——
    发布时才炸，而且错误信息指向数据库约束，看不出是算子那边多了一档。
    """
    assert set(SERVING_CHANNELS) == set(OPS)
