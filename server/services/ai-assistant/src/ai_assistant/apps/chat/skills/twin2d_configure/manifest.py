"""二维孪生草稿配置技能的清单。"""

from pathlib import Path

from ai_assistant.apps.chat.skills.manifest import SkillManifest

TWIN2D_CONFIGURE = SkillManifest(
    name="twin2d-configure",
    title="配置二维孪生",
    summary="读取并修改二维孪生已有节点、连线、标注、文档样式与画布配置，校验实际结果。",
    surface_kinds=("twin2d-editor",),
    required_codes=("dashboard:edit",),
    client_tools=(
        "dashboard.read_canvas",
        "twin2d.read_config",
        "twin2d.patch_config",
        "twin2d.diagnose",
    ),
    directory=Path(__file__).resolve().parent,
)
