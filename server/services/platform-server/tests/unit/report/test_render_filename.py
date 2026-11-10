"""成品下载名：模板名-报告期，放不进文件名的字符换掉。"""

import uuid

from platform_server.apps.report.models import ReportRender
from platform_server.apps.report.services.render_service import _filename_of

RENDER_ID = uuid.UUID("01a1c0fb-2cd5-73fb-ba52-77c874947c76")


def render(snapshot):
    return ReportRender(id=RENDER_ID, period="2026-08", snapshot_json=snapshot)


def test_path_separators_in_the_template_name_are_replaced():
    assert _filename_of(render({"name": "车间/月报:A"})) == (
        "车间_月报_A-2026-08.docx"
    )


def test_a_snapshot_without_a_name_falls_back_to_the_render_id():
    assert _filename_of(render({})) == f"report-{RENDER_ID}.docx"
