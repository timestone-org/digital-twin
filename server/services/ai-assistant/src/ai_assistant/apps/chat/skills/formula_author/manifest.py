"""公式辅助技能的清单。"""

from pathlib import Path

from ai_assistant.apps.chat.skills.manifest import SkillManifest

FORMULA_AUTHOR = SkillManifest(
    name="formula-author",
    title="写公式",
    summary=(
        "为台账的公式列写表达式，并当场校验与试算。"
        "用户说「算一下同比」「这一列怎么写」时用它。"
    ),
    surface_kinds=("dataset-table",),
    required_codes=("dataset:manage",),
    server_tools=(
        "formula.catalog",
        "formula.validate",
        "formula.preview",
    ),
    client_tools=("dataset.read_columns", "dataset.propose_formula"),
    directory=Path(__file__).resolve().parent,
)
