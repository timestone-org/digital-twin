"""大屏组态技能的清单。"""

from pathlib import Path

from ai_assistant.apps.chat.skills.manifest import SkillManifest

DASHBOARD_COMPOSE = SkillManifest(
    name="dashboard-compose",
    title="组态大屏",
    summary=(
        "在大屏上摆模块、改模块配置与外观、对齐排版。"
        "用户说「加一个…」「把边框去掉」「这几个对齐」时用它。"
    ),
    # ⚠ 只在大屏画布上：摆模块、改几何、对齐这些工具 2D 孪生舞台一个都没有，
    # 在那里宣告本技能等于摆一排调一次失败一次的名字
    surface_kinds=("dashboard-editor",),
    required_codes=("dashboard:edit",),
    server_tools=(
        "modules.catalog",
        "styles.list",
        "styles.get",
        "styles.save",
        "styles.delete",
    ),
    client_tools=(
        "dashboard.read_canvas",
        "dashboard.read_bindings",
        "dashboard.read_config",
        "dashboard.chrome_keys",
        "dashboard.add_module",
        "dashboard.remove_node",
        "dashboard.set_config",
        "dashboard.add_config_item",
        "dashboard.remove_config_item",
        "dashboard.set_geometry",
        "dashboard.arrange",
        "dashboard.write_binding",
    ),
    directory=Path(__file__).resolve().parent,
)
