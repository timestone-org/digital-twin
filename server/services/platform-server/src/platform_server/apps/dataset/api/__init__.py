"""HTTP 路由。业务不写在这里，路由函数只做取参 → 调 service → 包封。"""

from fastapi import APIRouter

from platform_server.apps.dataset.api import (
    dataset_columns,
    dataset_formula,
    dataset_overrides,
    dataset_records,
    dataset_series,
    dataset_tables,
)

ROUTERS: tuple[APIRouter, ...] = (
    dataset_tables.router,
    dataset_columns.router,
    dataset_formula.router,
    dataset_records.router,
    dataset_overrides.router,
    dataset_series.router,
)

__all__ = ["ROUTERS"]
