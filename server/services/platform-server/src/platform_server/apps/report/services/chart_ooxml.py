"""原生 DrawingML 折线和柱状图，复用备份模块的缓存数据与 OPC 装配方式。"""

from math import ceil
from xml.sax.saxutils import escape

from docx.document import Document
from docx.opc.part import Part
from docx.oxml import parse_xml

from platform_server.apps.report.schemas.preview import ChartSeries, NodeValue
from platform_server.apps.report.services.aggregation import decimal_value
from platform_server.apps.report.services.chart_theme import (
    AXIS_TEXT_COLOR,
    CHART_HEIGHT_EMU,
    GRID_COLOR,
    series_color,
)
from platform_server.apps.report.services.ooxml import append_xml

C_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CHART_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"
)
CHART_REL = f"{R_NS}/chart"
_CAT_AXIS = 101
_VAL_AXIS = 102


def _points(values: list[str | None]) -> str:
    return "".join(
        f'<c:pt idx="{index}"><c:v>{number}</c:v></c:pt>'
        for index, value in enumerate(values)
        if (number := decimal_value(value)) is not None
    )


def _categories(categories: list[str]) -> str:
    names = "".join(
        f'<c:pt idx="{index}"><c:v>{escape(name)}</c:v></c:pt>'
        for index, name in enumerate(categories)
    )
    return (
        f'<c:cat><c:strLit><c:ptCount val="{len(categories)}"/>'
        f"{names}</c:strLit></c:cat>"
    )


def _values(values: list[str | None]) -> str:
    return (
        "<c:val><c:numLit><c:formatCode>General</c:formatCode>"
        f'<c:ptCount val="{len(values)}"/>{_points(values)}</c:numLit></c:val>'
    )


def _fill(color: str) -> str:
    return f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'


def _series_xml(
    series: ChartSeries, index: int, categories: list[str], kind: str
) -> str:
    color = series_color(index)
    shape = (
        f'<c:spPr>{_fill(color)}<a:ln w="19050">{_fill(color)}</a:ln></c:spPr>'
    )
    # Word 对折线缺省按平滑曲线画，编辑器是直线段，故显式关掉。
    smooth = '<c:smooth val="0"/>' if kind != "bar" else ""
    marker = (
        '<c:marker><c:symbol val="none"/></c:marker>' if kind != "bar" else ""
    )
    return (
        f'<c:ser><c:idx val="{index}"/><c:order val="{index}"/>'
        f"<c:tx><c:v>{escape(series.name)}</c:v></c:tx>{shape}{marker}"
        f"{_categories(categories)}{_values(series.values)}{smooth}</c:ser>"
    )


def _pie_xml(series: ChartSeries, categories: list[str]) -> str:
    slices = "".join(
        f'<c:dPt><c:idx val="{index}"/><c:bubble3D val="0"/>'
        f'<c:spPr>{_fill(series_color(index))}<a:ln w="9525">'
        f'{_fill("FFFFFF")}</a:ln></c:spPr></c:dPt>'
        for index in range(len(categories))
    )
    labels = (
        '<c:dLbls><c:dLblPos val="outEnd"/>'
        '<c:showLegendKey val="0"/><c:showVal val="0"/>'
        '<c:showCatName val="0"/><c:showSerName val="0"/>'
        '<c:showPercent val="1"/><c:showBubbleSize val="0"/></c:dLbls>'
    )
    return (
        '<c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/>'
        f'<c:order val="0"/><c:tx><c:v>{escape(series.name)}</c:v></c:tx>'
        f"{slices}{labels}{_categories(categories)}{_values(series.values)}"
        '</c:ser><c:firstSliceAng val="0"/></c:pieChart>'
    )


def _plot_xml(node: NodeValue) -> str:
    if node.kind == "pie":
        return _pie_xml(node.series[0], node.categories)
    series_xml = "".join(
        _series_xml(series, index, node.categories, node.kind)
        for index, series in enumerate(node.series)
    )
    kind = "barChart" if node.kind == "bar" else "lineChart"
    direction = '<c:barDir val="col"/>' if node.kind == "bar" else ""
    grouping = "clustered" if node.kind == "bar" else "standard"
    count = len(node.categories)
    return (
        f'<c:{kind}>{direction}<c:grouping val="{grouping}"/>{series_xml}'
        f'<c:axId val="{_CAT_AXIS}"/><c:axId val="{_VAL_AXIS}"/></c:{kind}>'
        f'{_axis("catAx", _CAT_AXIS, _VAL_AXIS, "b", count)}'
        f'{_axis("valAx", _VAL_AXIS, _CAT_AXIS, "l", count)}'
    )


def has_legend(node: NodeValue) -> bool:
    """图例只在能区分多条内容时出现，编辑器同一口径。Args: node。"""
    return node.kind == "pie" or len(node.series) > 1


def chart_xml(node: NodeValue) -> bytes:
    """构造图表 XML，缺失值保留断点。Args: node。"""
    if not node.categories or not node.series:
        raise ValueError("图表没有有效数据")
    legend = (
        '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>'
        if has_legend(node)
        else ""
    )
    xml = (
        f'<c:chartSpace xmlns:c="{C_NS}" xmlns:a="{A_NS}"><c:chart>'
        '<c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>'
        f"{_plot_xml(node)}</c:plotArea>{legend}"
        '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>'
        f'</c:chart><c:spPr>{_fill("FFFFFF")}<a:ln><a:noFill/></a:ln></c:spPr>'
        '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900">'
        f"{_fill(AXIS_TEXT_COLOR)}"
        '<a:latin typeface="Noto Sans CJK SC"/>'
        '<a:ea typeface="Noto Sans CJK SC"/>'
        '</a:defRPr></a:pPr><a:endParaRPr lang="zh-CN"/>'
        "</a:p></c:txPr></c:chartSpace>"
    )
    parse_xml(xml.encode())
    return xml.encode()


def _axis(
    kind: str, axis_id: int, cross_id: int, position: str, count: int
) -> str:
    step = max(1, ceil(count / 6))
    category = (
        f'<c:tickLblSkip val="{step}"/><c:tickMarkSkip val="{step}"/>'
        if kind == "catAx"
        else ""
    )
    grid = (
        f'<c:majorGridlines><c:spPr><a:ln w="6350">{_fill(GRID_COLOR)}'
        "</a:ln></c:spPr></c:majorGridlines>"
        if kind == "valAx"
        else ""
    )
    return (
        f'<c:{kind}><c:axId val="{axis_id}"/><c:scaling>'
        '<c:orientation val="minMax"/></c:scaling>'
        f'<c:delete val="0"/><c:axPos val="{position}"/>{grid}'
        '<c:numFmt formatCode="General" sourceLinked="0"/>'
        '<c:majorTickMark val="none"/><c:minorTickMark val="none"/>'
        '<c:tickLblPos val="nextTo"/>'
        f'<c:spPr><a:ln w="6350">{_fill(GRID_COLOR)}</a:ln></c:spPr>'
        f'<c:crossAx val="{cross_id}"/><c:crosses val="autoZero"/>'
        f"{category}</c:{kind}>"
    )


def add_chart(document: Document, node: NodeValue) -> None:
    """把图表部件挂到文档并内联显示。Args: document, node。"""
    package = document.part.package
    if package is None:
        raise ValueError("文档缺少 OPC 包")
    part = Part(
        package.next_partname("/word/charts/chart%d.xml"),
        CHART_CONTENT_TYPE,
        chart_xml(node),
        package,
    )
    relation = document.part.relate_to(part, CHART_REL)
    drawing_id = len(document.inline_shapes) + 1
    width = (
        int(document.sections[0].page_width or 7_560_000)
        - int(document.sections[0].left_margin or 0)
        - int(document.sections[0].right_margin or 0)
    )
    xml = (
        "<w:drawing "
        'xmlns:w="http://schemas.openxmlformats.org/'
        'wordprocessingml/2006/main" '
        'xmlns:wp="http://schemas.openxmlformats.org/'
        'drawingml/2006/wordprocessingDrawing" '
        f'xmlns:a="{A_NS}" xmlns:c="{C_NS}" xmlns:r="{R_NS}">'
        f'<wp:inline><wp:extent cx="{width}" cy="{CHART_HEIGHT_EMU}"/>'
        f'<wp:docPr id="{drawing_id}" name="Report chart {drawing_id}"/>'
        f'<a:graphic><a:graphicData uri="{C_NS}"><c:chart r:id="{relation}"/>'
        "</a:graphicData></a:graphic></wp:inline></w:drawing>"
    )
    paragraph = document.add_paragraph()
    paragraph.paragraph_format.line_spacing = 1.0
    paragraph.paragraph_format.keep_together = True
    append_xml(paragraph.add_run(), xml)
