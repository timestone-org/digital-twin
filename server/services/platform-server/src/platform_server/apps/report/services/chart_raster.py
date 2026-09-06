"""位图图表后备路径，动态绘图库在边界收敛成最小协议。"""

import io
from collections.abc import Sequence
from typing import Protocol, cast
from zoneinfo import ZoneInfo

from matplotlib import font_manager
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
from matplotlib.font_manager import FontProperties
from matplotlib.text import Text

from platform_server.apps.report.schemas.preview import NodeValue
from platform_server.apps.report.services.aggregation import decimal_value


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
    ) -> object: ...
    def plot(
        self, positions: Sequence[float], values: Sequence[float], *, label: str
    ) -> object: ...
    def set_title(
        self, text: str, *, fontproperties: FontProperties
    ) -> object: ...
    def legend(self, *, prop: FontProperties) -> object: ...
    def set_xticks(
        self, ticks: Sequence[float], labels: Sequence[str]
    ) -> object: ...
    def get_xticklabels(self) -> list[Text]: ...
    def get_yticklabels(self) -> list[Text]: ...


def render_chart(node: NodeValue, timezone: str) -> bytes:
    """生成中文 PNG 图表。Args: node, timezone。"""
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
    _draw_series(axes, node, timezone)
    axes.set_title(node.title, fontproperties=font)
    axes.legend(prop=font)
    for label in (*axes.get_xticklabels(), *axes.get_yticklabels()):
        label.set_fontproperties(font)
    figure.autofmt_xdate()
    figure.tight_layout()
    output = io.BytesIO()
    cast(Canvas, FigureCanvasAgg(figure)).print_png(output)
    figure.clear()
    return output.getvalue()


def _draw_series(axes: Axes, node: NodeValue, timezone: str) -> None:
    domain = sorted(
        {point.ts for series in node.series for point in series.points}
    )
    ticks = [float(index) for index in range(len(domain))]
    width = 0.8 / max(1, len(node.series))
    for index, series in enumerate(node.series):
        values = {
            point.ts: decimal_value(point.value) for point in series.points
        }
        numbers = [
            (
                float(number)
                if (number := values.get(stamp)) is not None
                else float("nan")
            )
            for stamp in domain
        ]
        if node.kind == "bar":
            positions = [tick - 0.4 + width * (index + 0.5) for tick in ticks]
            axes.bar(positions, numbers, label=series.name, width=width)
        else:
            axes.plot(ticks, numbers, label=series.name)
    step = max(1, len(domain) // 8)
    labels = [
        stamp.astimezone(ZoneInfo(timezone)).strftime("%m-%d %H:%M")
        for stamp in domain
    ]
    axes.set_xticks(ticks[::step], labels[::step])
