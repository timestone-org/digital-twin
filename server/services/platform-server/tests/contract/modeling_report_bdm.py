"""能管取数的满列数、长时间轴与截断状态报告夹具。"""

from collections.abc import Mapping
from dataclasses import replace
from typing import Any

from platform_server.apps.modeling.operators import Frame, Provenance
from platform_server.apps.modeling.operators.base import PREFETCHED_KEY

BDM_COLUMNS = 10
type Case = tuple[dict[str, Any], dict[str, Any]]


def bdm_frames(numeric: Frame, categorical: Frame) -> dict[str, Frame]:
    """把长轴帧收窄到取数标识上限并保留截断提示。

    Args: numeric, categorical。
    """
    return {
        "bdm_number": replace(
            numeric,
            columns=numeric.columns[:BDM_COLUMNS],
            rows=tuple(row[:BDM_COLUMNS] for row in numeric.rows),
            provenance=Provenance(is_truncated=True),
        ),
        "bdm_string": replace(
            categorical, provenance=Provenance(is_truncated=True)
        ),
    }


def bdm_loads(pool: Mapping[str, Frame]) -> tuple[Case, ...]:
    """为数值与文本两种输出绑定满列数取数配置。

    Args: pool。
    """
    return tuple(
        (
            {PREFETCHED_KEY: pool[f"bdm_{value_type}"]},
            {
                "identifiers": [
                    column.key for column in pool[f"bdm_{value_type}"].columns
                ],
                "since": "-366d",
                "value_type": value_type,
                "row_limit": pool[f"bdm_{value_type}"].row_count,
            },
        )
        for value_type in ("number", "string")
    )
