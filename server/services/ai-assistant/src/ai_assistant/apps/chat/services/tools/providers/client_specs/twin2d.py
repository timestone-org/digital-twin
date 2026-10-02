"""二维孪生文档草稿的读取、校验修改和诊断工具规格。"""

from ai_assistant.apps.chat.services.tools.pagination import page_properties
from llmcore.tools.shapes import ToolSpec, object_schema, string_schema

SECTIONS = ("canvas", "nodes", "edges", "marks", "styles", "edgeStyles")

TWIN2D_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="twin2d.read_config",
        description=(
            "读取当前二维孪生未保存文档。canvas 是单例，不接收 id；"
            "其它 section 不给 id 时返回按 keyword 筛选的实体名片，"
            "每页最多20条，按 next_page 续查。给名片 id 时读完整配置。"
            "styles/edgeStyles 只读取文档中已有的样式，不包含预置库。"
        ),
        parameters=object_schema(
            {
                "section": {"type": "string", "enum": SECTIONS},
                "id": string_schema("读取实体详情时逐字复制名片 id"),
                "keyword": string_schema("按 id 或名称字面包含筛选"),
                **page_properties(),
            },
            ["section"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="twin2d.patch_config",
        description=(
            "修改二维孪生已有配置。canvas 不给 id，其它 section 必须给实体 id。"
            "patch 只能包含读取结果已有的字段，不改 id、不新增删除实体。"
            "对象按叶子深合并，数组整段替换；新增悬空引用或丢弃配置会拒绝。"
            "越界或非法值不能静默回落；写入现有撤销栈并重派绑定，"
            "返回实际配置与诊断，尚未保存。"
        ),
        parameters=object_schema(
            {
                "section": {"type": "string", "enum": SECTIONS},
                "id": string_schema("实体稳定 id"),
                "patch": {"type": "object", "additionalProperties": True},
            },
            ["section", "patch"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="twin2d.diagnose",
        description="诊断当前二维孪生草稿的引用、图元、边界与被丢弃的配置。每批修改后必须调用。",
        parameters=object_schema({}, []),
        runs_on="client",
    ),
)
