"""三维孪生配置的客户端工具规格。"""

from llmcore.tools.shapes import ToolSpec, object_schema, string_schema

SECTIONS = (
    "model",
    "viewpoints",
    "roam",
    "parts",
    "anchors",
    "cameras",
    "panels",
    "arrows",
    "flows",
)

TWIN_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="twin.read_config",
        description=(
            "读取当前未保存的三维孪生配置。section 取 model/viewpoints/roam/"
            "parts/anchors/cameras/panels/arrows/flows。数组节不给 id 时返回"
            "最多 100 条名片；给 id 时返回完整配置。修改前必须先读。"
        ),
        parameters=object_schema(
            {
                "section": {
                    "type": "string",
                    "enum": SECTIONS,
                    "description": "要读取的配置节",
                },
                "id": string_schema("数组节中的实体 id；读取完整项时给"),
            },
            ["section"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="twin.patch_config",
        description=(
            "修改当前未保存的三维孪生配置，并进入页面撤销栈。section 与读取工具"
            "相同；数组节必须给实体 id。patch 只能包含读回配置已有的键且"
            "不能改 id。"
            "对象按叶子深合并，数组整段替换。返回值是归一化后的真实结果，"
            "范围夹取与缺省回落都以它为准。"
        ),
        parameters=object_schema(
            {
                "section": {
                    "type": "string",
                    "enum": SECTIONS,
                    "description": "要修改的配置节",
                },
                "id": string_schema("数组节中的实体 id"),
                "patch": {
                    "type": "object",
                    "description": "只给要修改的字段；嵌套对象可只给叶子",
                    "additionalProperties": True,
                },
            },
            ["section", "patch"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="twin.diagnose",
        description=(
            "诊断当前未保存的三维孪生配置，返回悬空引用、不可达点击、空详情、"
            "染色区间与漫游等跨字段问题。修改后必须调用。"
        ),
        parameters=object_schema({}, []),
        runs_on="client",
    ),
)
