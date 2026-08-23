"""台账与公式库两面「哪条路由该要哪个码」的口径。

与逐条断言分开放，是因为这份口径与 auth-server 的闸 1 规则表是**两份各自写
的**：两边都从 docs/DATASET_DESIGN.md §9 抄，而不是互相 import——一份写歪时，
另一份才照得出来（这边钉端点，auth-server 的 `test_dataset_route_matrix.py`
钉规则）。
"""

from platform_server.apps.dataset.catalog import (
    DATASET_BACKFILL,
    DATASET_MANAGE,
    DATASET_OVERRIDE,
    DATASET_RECORD_WRITE,
    DATASET_VIEW,
    FORMULA_MANAGE,
    FORMULA_VIEW,
)
from platform_server.settings import API_PREFIX

# 数据台账。闸 1 里对应的同样是按前缀的窄规则，自下而上一级压一级：写兜底 →
# 读 → 重算 → 记录写 → 记录读 → 修正 → 回填 → 回填进度读。CSV 导出另有自己的
# 码，随它的端点一起登记（docs/DATASET_DESIGN.md §9）。
DATASET_PREFIXES = (f"{API_PREFIX}/dataset-tables",)
# ⚠ 公式库与 `dataset-tables` **平级**，且自带两个码：改一条库公式会同时改掉
# 所有引用它的台账列，爆炸半径大一个量级，故不跟着 `dataset:manage` 走（§9）
FORMULA_PREFIX = f"{API_PREFIX}/formulas"
DATASET_TABLE = f"{API_PREFIX}/dataset-tables/{{table_id}}"
# 人工修正自成一个码：修正值优先于点位聚合值，等同于篡改台账
DATASET_OVERRIDDEN = (
    (f"{DATASET_TABLE}/records/{{row_id}}/overrides", "PUT"),
    (f"{DATASET_TABLE}/records/{{row_id}}/overrides", "DELETE"),
    (f"{DATASET_TABLE}/overrides:clear", "POST"),
)
# 全表重算与历史回填都大批量改写历史行且吃满数据库。⚠ 回填的 GET 不在这里：
# 看一眼进度的人不该顺带拿到改写历史的权限，它落在按方法的读兜底上
DATASET_BACKFILLED = (
    (f"{DATASET_TABLE}:recompute", "POST"),
    (f"{DATASET_TABLE}/backfill", "POST"),
    (f"{DATASET_TABLE}/backfill", "DELETE"),
)
# 记录面的读：翻页、最新值、序列
DATASET_RECORD_READS = (
    f"{DATASET_TABLE}/records",
    f"{DATASET_TABLE}/latest",
    f"{DATASET_TABLE}/series",
)


def dataset_expectation(path: str, method: str) -> frozenset[str] | None:
    """台账与公式库两面某条路由该要哪个码；别处的路由给 None。

    Args: path, method。
    """
    if path.startswith(FORMULA_PREFIX):
        return frozenset({FORMULA_VIEW if method == "GET" else FORMULA_MANAGE})
    if not any(path.startswith(prefix) for prefix in DATASET_PREFIXES):
        return None
    if (path, method) in DATASET_OVERRIDDEN:
        return frozenset({DATASET_OVERRIDE})
    if (path, method) in DATASET_BACKFILLED:
        return frozenset({DATASET_BACKFILL})
    if method == "GET":
        return frozenset({DATASET_VIEW})
    is_record = path.startswith(f"{DATASET_TABLE}/records")
    return frozenset({DATASET_RECORD_WRITE if is_record else DATASET_MANAGE})
