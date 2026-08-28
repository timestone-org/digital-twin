"""批量绑点技能的清单。"""

from pathlib import Path

from ai_assistant.apps.chat.skills.manifest import SkillManifest

DASHBOARD_BINDING = SkillManifest(
    name="dashboard-binding",
    title="批量绑点",
    summary=(
        "把大屏上模块的数据槽位批量绑到采集点位上。"
        "用户描述要绑什么、或上传一张点表时用它。"
    ),
    # 2D 孪生也在列：它同样是「一堆槽位等着接点位」，绑定那套工具形状一致
    surface_kinds=("dashboard-editor", "twin-editor", "twin2d-editor"),
    required_codes=("dashboard:edit", "collect:view"),
    server_tools=(
        "points.list_sources",
        "points.search",
        "points.resolve",
        "dashboard.validate",
    ),
    client_tools=(
        "dashboard.read_canvas",
        "dashboard.read_bindings",
        "dashboard.write_binding",
        "dashboard.remove_binding",
        "dashboard.copy_bindings",
        "dashboard.read_values",
        "dashboard.save",
    ),
    directory=Path(__file__).resolve().parent,
)
