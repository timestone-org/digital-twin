"""HTTP 路由。业务不写在这里，路由函数只做取参 → 调 service → 包封。"""

from fastapi import APIRouter

from platform_server.apps.dataset.api import (
    dataset_backfill,
    dataset_columns,
    dataset_formula,
    dataset_formulas,
    dataset_overrides,
    dataset_records,
    dataset_runtime_params,
    dataset_series,
    dataset_tables,
)

ROUTERS: tuple[APIRouter, ...] = (
    # ⚠ 必须排在 `dataset_tables` **之前**：两者的 `GET /dataset-tables/…` 只差
    # 一个字面量段与一个 UUID 路径参数，排在后面时 `runtime-params` 会先落到
    # `{table_id}` 上并当场 422，而不是回落到这条路由
    dataset_runtime_params.router,
    dataset_tables.router,
    dataset_columns.router,
    dataset_formula.router,
    # ⚠ 与 `dataset-tables` 平级：一条库公式属于全库，不属于某一张台账
    dataset_formulas.router,
    dataset_records.router,
    dataset_overrides.router,
    dataset_series.router,
    dataset_backfill.router,
)

__all__ = ["ROUTERS"]
