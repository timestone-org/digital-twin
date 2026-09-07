"""三维孪生配置技能的清单。"""

from pathlib import Path

from ai_assistant.apps.chat.skills.manifest import SkillManifest

TWIN_CONFIGURE = SkillManifest(
    name="twin-configure",
    title="配置三维孪生",
    summary=(
        "修改三维孪生的模型、部件、锚点、视点、信息牌、箭头、"
        "能量流和漫游配置，并诊断与截图核验。"
    ),
    surface_kinds=("twin-editor",),
    required_codes=("dashboard:edit",),
    client_tools=(
        "twin.read_config",
        "twin.patch_config",
        "twin.diagnose",
        "dashboard.capture",
        "dashboard.save",
    ),
    directory=Path(__file__).resolve().parent,
)
