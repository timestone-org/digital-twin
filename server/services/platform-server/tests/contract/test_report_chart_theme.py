"""报告图表配色与高度在 Word 生成器与编辑器两侧逐字一致。

编辑器正文用 ECharts 复刻 Word 原生图表；任一侧改了色板或高度，两边成品
看起来就不再是同一张图，而类型检查与单测都不会报错。
"""

import re
from pathlib import Path

from platform_server.apps.report.services.chart_theme import (
    AXIS_TEXT_COLOR,
    CHART_HEIGHT_EMU,
    GRID_COLOR,
    SERIES_COLORS,
)

ROOT = Path(__file__).resolve().parents[5]
THEME = (
    ROOT / "web/app/src/pages/Reports/Editor/scripts/reportChartTheme.ts"
).read_text(encoding="utf-8")
EMU_PER_CM = 360_000


def _block(name: str) -> str:
    found = re.search(rf"{name}\s*=\s*([\[{{][^\]}}]*[\]}}])", THEME)
    assert found, name
    return found.group(1)


def test_series_palette_matches_word():
    colors = re.findall(r"#([0-9A-Fa-f]{6})", _block("REPORT_SERIES_COLORS"))
    assert [color.upper() for color in colors] == list(SERIES_COLORS)


def test_print_colors_match_word_axis_and_grid():
    block = _block("REPORT_PRINT_COLORS")
    assert f"#{AXIS_TEXT_COLOR}".lower() in block.lower()
    assert f"#{GRID_COLOR}".lower() in block.lower()


def test_chart_height_matches_word():
    found = re.search(r"REPORT_CHART_HEIGHT_CM\s*=\s*([\d.]+)", THEME)
    assert found
    assert round(CHART_HEIGHT_EMU / EMU_PER_CM, 2) == float(found.group(1))
