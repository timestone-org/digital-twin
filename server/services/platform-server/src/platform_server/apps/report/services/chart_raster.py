"""位图图表后备路径，动态绘图库在边界收敛成最小协议。"""

import io
from collections.abc import Sequence
from math import ceil, isnan
from typing import Protocol, cast

from matplotlib import font_manager
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
from matplotlib.font_manager import FontProperties
from matplotlib.text import Text

from platform_server.apps.report.schemas.preview import NodeValue
from platform_server.apps.report.services.aggregation import decimal_value
from platform_server.apps.report.services.chart_ooxml import has_legend
from platform_server.apps.report.services.chart_theme import series_color


class FontFinder(Protocol):
    def findfont(self, prop: FontProperties, **options: object) -> str: ...


class FontFile(Protocol):
    def set_file(self, filename: str) -> None: ...


class Canvas(Protocol):
    def print_png(self, output: io.BytesIO) -> None: ...


class Axes(Protocol):
    def bar(
        self,
        positions: Sequence[float],
        values: Sequence[float],
        *,
        label: str,
        width: float,
        color: str,
    ) -> object: ...
    def plot(
        self,
        positions: Sequence[float],
        values: Sequence[float],
        *,
        label: str,
        color: str,
    ) -> object: ...
    def pie(
        self,
        values: Sequence[float],
        *,
        labels: Sequence[str],
        colors: Sequence[str],
        autopct: str,
        textprops: dict[str, FontProperties],
    ) -> object: ...
    def legend(self, *, prop: FontProperties) -> object: ...
    def set_xticks(
        self, ticks: Sequence[float], labels: Sequence[str]
    ) -> object: ...
    def get_xticklabels(self) -> list[Text]: ...
    def get_yticklabels(self) -> list[Text]: ...


def render_chart(node: NodeValue) -> bytes:
    """生成中文 PNG 图表。Args: node。"""
    font = FontProperties(
        family=[
            "Noto Sans CJK SC",
            "Noto Sans CJK JP",
            "Arial Unicode MS",
            "SimHei",
        ]
    )
    # Matplotlib 的 PathLike 与 kwargs 标注不完整，只在此边界收敛。
    filename = cast(FontFinder, font_manager).findfont(
        font, fallback_to_default=False
    )
    cast(FontFile, font).set_file(filename)
    figure = Figure(figsize=(7, 3.5), dpi=144)
    axes = cast(Axes, figure.subplots())
    if not node.categories or not node.series:
        raise ValueError("图表没有有效数据")
    _draw_series(axes, node, font)
    if has_legend(node) and node.kind != "pie":
        axes.legend(prop=font)
    for label in (*axes.get_xticklabels(), *axes.get_yticklabels()):
        label.set_fontproperties(font)
    figure.autofmt_xdate()
    figure.tight_layout()
    output = io.BytesIO()
    cast(Canvas, FigureCanvasAgg(figure)).print_png(output)
    figure.clear()
    return output.getvalue()


def _draw_series(axes: Axes, node: NodeValue, font: FontProperties) -> None:
    ticks = [float(index) for index in range(len(node.categories))]
    if node.kind == "pie":
        values = [_number(value) for value in node.series[0].values]
        kept = [
            (label, value, f"#{series_color(index)}")
            for index, (label, value) in enumerate(
                zip(node.categories, values, strict=True)
            )
            if not isnan(value) and value > 0
        ]
        axes.pie(
            [value for _, value, _ in kept],
            labels=[label for label, _, _ in kept],
            colors=[color for _, _, color in kept],
            autopct="%1.1f%%",
            textprops={"fontproperties": font},
        )
        return
    width = 0.8 / max(1, len(node.series))
    for index, series in enumerate(node.series):
        numbers = [_number(value) for value in series.values]
        color = f"#{series_color(index)}"
        if node.kind == "bar":
            positions = [tick - 0.4 + width * (index + 0.5) for tick in ticks]
            axes.bar(
                positions, numbers, label=series.name, width=width, color=color
            )
        else:
            axes.plot(ticks, numbers, label=series.name, color=color)
    step = max(1, ceil(len(node.categories) / 8))
    axes.set_xticks(ticks[::step], node.categories[::step])


def _number(value: str | None) -> float:
    number = decimal_value(value)
    return float(number) if number is not None else float("nan")
