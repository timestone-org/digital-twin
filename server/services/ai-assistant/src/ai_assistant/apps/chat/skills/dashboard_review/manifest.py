"""布局审阅技能的清单。"""

from pathlib import Path

from ai_assistant.apps.chat.skills.manifest import SkillManifest

DASHBOARD_REVIEW = SkillManifest(
    name="dashboard-review",
    title="看图提建议",
    summary=(
        "截当前大屏的图，看画面提布局、配色、信息层级上的改进建议。"
        "用户说「看看我这屏怎么样」「帮我优化布局」时用它。"
    ),
    surface_kinds=("dashboard-editor", "twin-editor"),
    required_codes=("dashboard:edit",),
    server_tools=(),
    client_tools=("dashboard.capture", "dashboard.read_canvas"),
    directory=Path(__file__).resolve().parent,
)
