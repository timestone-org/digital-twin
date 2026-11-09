"""报告图表与表格的印刷配色与尺寸，编辑器正文按同一份数值绘制。

前端副本在 web/app/src/pages/Reports/Editor/scripts/reportChartTheme.ts，
两侧由 tests/contract/test_report_chart_theme.py 逐字比对。
"""

SERIES_COLORS = (
    "35618D",
    "25847D",
    "B77936",
    "805EA0",
    "B5485A",
    "4F8FBF",
    "7A8B3D",
    "8C6D5A",
)
CHART_HEIGHT_EMU = 2_800_000
AXIS_TEXT_COLOR = "595959"
GRID_COLOR = "D9D9D9"
TABLE_BORDER_COLOR = "D9D9D9"
TABLE_HEAD_COLOR = "E8EEF4"
TABLE_ZEBRA_COLOR = "F7F9FB"


def series_color(index: int) -> str:
    """按序号循环取色。Args: index。"""
    return SERIES_COLORS[index % len(SERIES_COLORS)]
