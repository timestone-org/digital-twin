"""Word 文本水印的原生 VML 形状，沿用参考模块的 WordArt 定义。"""

from xml.sax.saxutils import quoteattr

from platform_server.apps.report.schemas.document import Watermark

_SHAPE = (
    '<v:shapetype id="_x0000_t136" coordsize="21600,21600"'
    ' o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e">'
    "<v:formulas>"
    '<v:f eqn="sum #0 0 10800"/>'
    '<v:f eqn="prod #0 2 1"/>'
    '<v:f eqn="sum 21600 0 @1"/>'
    '<v:f eqn="sum 0 0 @2"/>'
    '<v:f eqn="sum 21600 0 @3"/>'
    '<v:f eqn="if @0 @3 0"/>'
    '<v:f eqn="if @0 21600 @1"/>'
    '<v:f eqn="if @0 0 @2"/>'
    '<v:f eqn="if @0 @4 21600"/>'
    '<v:f eqn="mid @5 @6"/>'
    '<v:f eqn="mid @8 @5"/>'
    '<v:f eqn="mid @7 @8"/>'
    '<v:f eqn="mid @6 @7"/>'
    '<v:f eqn="sum @6 0 @5"/>'
    "</v:formulas>"
    '<v:path textpathok="t" o:connecttype="custom"'
    ' o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" '
    'o:connectangles="270,180,90,0"/>'
    '<v:textpath on="t" fitshape="t"/>'
    "<v:handles>"
    '<v:h position="#0,bottomRight" xrange="6629,14971"/>'
    "</v:handles>"
    '<o:lock v:ext="edit" text="t" shapetype="t"/>'
    "</v:shapetype>"
)


def watermark_xml(watermark: Watermark) -> str:
    """生成居中且位于正文之后的水印。Args: watermark。"""
    style = (
        "position:absolute;margin-left:0;margin-top:0;"
        f"width:{watermark.font_size_pt * len(watermark.text):.1f}pt;"
        f"height:{watermark.font_size_pt * 1.5:.1f}pt;"
        f"rotation:{watermark.rotation};z-index:-251654144;"
        "mso-position-horizontal:center;"
        "mso-position-horizontal-relative:margin;"
        "mso-position-vertical:center;"
        "mso-position-vertical-relative:margin"
    )
    return (
        '<w:pict xmlns:w="http://schemas.openxmlformats.org/'
        'wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:o="urn:schemas-microsoft-com:office:office">'
        f'{_SHAPE}<v:shape id="ReportWatermark" type="#_x0000_t136" '
        f'style={quoteattr(style)} fillcolor="silver" stroked="f">'
        '<v:fill opacity="0.2"/><v:textpath '
        'style="font-family:SimSun;font-size:1pt" '
        f"string={quoteattr(watermark.text)}/>"
        "</v:shape></w:pict>"
    )
