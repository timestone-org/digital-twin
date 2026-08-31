"""大屏联动技能的清单。"""

from pathlib import Path

from ai_assistant.apps.chat.skills.manifest import SkillManifest

DASHBOARD_INTERACT = SkillManifest(
    name="dashboard-interact",
    title="配联动",
    summary=(
        "把一块可点的模块接到别处：点一下显示 / 隐藏 / 切换、弹出弹窗、"
        "跳到另一张大屏。用户说「点这个按钮弹出…」「切换的时候换一组图表」"
        "「点进去看明细」时用它。"
    ),
    # ⚠ 只在大屏画布上：联动规则住在大屏级 chromeJson，孪生舞台没有这一层
    surface_kinds=("dashboard-editor",),
    required_codes=("dashboard:edit",),
    # 跨屏跳转的目标是**另一张大屏的 id**，只有这个工具答得出有哪些
    server_tools=("dashboards.list",),
    client_tools=(
        "dashboard.read_canvas",
        "dashboard.read_interactions",
        "dashboard.write_interaction",
        "dashboard.remove_interaction",
        "dashboard.set_visible",
        "dashboard.capture",
    ),
    directory=Path(__file__).resolve().parent,
)
