"""布局审阅技能的清单。"""

from pathlib import Path

from ai_assistant.apps.chat.skills.manifest import SkillManifest

DASHBOARD_REVIEW = SkillManifest(
    name="dashboard-review",
    title="看图提建议",
    summary=(
        "截当前画面的图，看画面提布局、配色、信息层级上的改进建议。"
        "用户说「看看我这屏怎么样」「帮我优化布局」时用它。"
    ),
    # 孪生编辑器也在列：视口虽是 WebGL，前端截图走「先画一帧再拷」的替身，
    # 3D 画面截得到。⚠ 2D 孪生不在列：那一页是 SVG/DOM 舞台，`dashboard.capture`
    # 那条链路没在它上面验过，而本技能除了截图没有别的手段
    surface_kinds=("dashboard-editor", "twin-editor"),
    required_codes=("dashboard:edit",),
    server_tools=(),
    client_tools=("dashboard.capture", "dashboard.read_canvas"),
    directory=Path(__file__).resolve().parent,
)
