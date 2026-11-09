"""报告 API 来源的映射字段上限在后端校验与编辑器表单两侧一致。

前端只按自己的常量拦截与禁用「添加字段」；两边数不同时，要么界面放行后保存被
422 拒绝，要么界面先拦住后端本来允许的配置，类型检查都看不出来。
"""

import re
from pathlib import Path

from platform_server.apps.report.schemas.api_source import MAX_COLUMNS

ROOT = Path(__file__).resolve().parents[5]
FORM = ROOT / "web/app/src/pages/Reports/Editor/scripts/apiSourceForm.ts"


def test_column_limit_matches_editor_form():
    found = re.search(
        r"MAX_API_COLUMNS\s*=\s*(\d+)", FORM.read_text(encoding="utf-8")
    )
    assert found
    assert int(found.group(1)) == MAX_COLUMNS
