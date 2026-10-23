"""固定采样网格的完整窗口求和；缺桶、重复桶或无效值均保留为空。"""

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

from platform_server.apps.dataset.formula.errors import FormulaError
from platform_server.apps.dataset.formula.values import finite, to_number


def sum_complete_window(
    values: Iterable[tuple[datetime, object]],
    since: datetime,
    until: datetime,
    step_s: int,
) -> float | None:
    """合计完整且每格有效的窗口。Args: values, since, until, step_s。"""
    start, end = since.astimezone(UTC), until.astimezone(UTC)
    step = timedelta(seconds=step_s)
    span = end - start
    if span < timedelta(0) or span % step != timedelta(0):
        return None
    rows = sorted(values, key=lambda row: row[0])
    if len(rows) != span // step + 1:
        return None
    total = 0.0
    for index, (ts, raw) in enumerate(rows):
        if ts != start + index * step:
            return None
        try:
            number = to_number(raw, where="完整窗口合计")
        except FormulaError:
            return None
        if number is None:
            return None
        total += number
    return finite(total)
