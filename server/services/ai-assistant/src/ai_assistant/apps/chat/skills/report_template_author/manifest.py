"""报告模板配置技能的清单。"""

from pathlib import Path

from ai_assistant.apps.chat.skills.manifest import SkillManifest

REPORT_TEMPLATE_AUTHOR = SkillManifest(
    name="report-template-author",
    title="配置报告模板",
    summary=(
        "读取当前报告草稿，配置指标、正文数据内容与页面设置，"
        "并用校验和试算核对结果。"
    ),
    surface_kinds=("report-editor",),
    required_codes=("report:manage",),
    client_tools=(
        "report.read_draft",
        "report.set_template",
        "report.upsert_metric",
        "report.insert_content",
        "report.set_page",
        "report.validate_draft",
        "report.preview_draft",
    ),
    directory=Path(__file__).resolve().parent,
)
