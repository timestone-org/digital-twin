"""查知识库技能的清单。"""

from pathlib import Path

from ai_assistant.apps.chat.skills.manifest import SkillManifest

KNOWLEDGE_QA = SkillManifest(
    name="knowledge-qa",
    title="查知识库",
    summary=(
        "按知识库里的手册、规程与台账资料回答问题，每句结论都给出处。"
        "用户问「手册怎么说」「规程要求多少」时用它。"
    ),
    # ⚠ 每个工作面都装：问一句资料这件事与用户站在哪一页无关。技能是渐进披露的
    # （正文只在被选中之后才注入），所以多装一个的常驻成本只有一句简介
    surface_kinds=(
        "dashboard-editor",
        "twin-editor",
        "twin2d-editor",
        "dashboard-view",
        "dataset-table",
        "collect-source",
    ),
    required_codes=("knowledge:use",),
    server_tools=("knowledge.list_bases", "knowledge.search"),
    client_tools=(),
    directory=Path(__file__).resolve().parent,
)
