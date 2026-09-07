"""三维孪生配置的客户端工具规格。"""

from llmcore.tools.shapes import ToolSpec, object_schema, string_schema

ENTITY_SECTIONS = (
    "parts",
    "anchors",
    "cameras",
    "panels",
    "arrows",
    "flows",
)
SINGLETON_SECTIONS = ("model", "viewpoints", "roam")
SECTIONS = (*SINGLETON_SECTIONS, *ENTITY_SECTIONS)

TWIN_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="twin.list_folders",
        description=(
            "一次读取当前未保存三维孪生中六类实体的全局文件夹目录。"
            "返回 schema_version，以及 folders；每个目录项是 "
            "{section,folder_id,name,item_count}。文件夹的稳定身份是 "
            "section 与 folder_id 的组合。问题涉及『某一类』时必须先调用"
            "本工具，不能从文件夹名字猜 id。"
        ),
        parameters=object_schema({}, []),
        runs_on="client",
    ),
    ToolSpec(
        name="twin.list_entities",
        description=(
            "列出当前未保存三维孪生中一个实体节的名片，可按文件夹筛选。"
            "返回 schema_version、section、applied_folder_id、最多 100 条 "
            "items 与 is_truncated；每项是 {id,name,folder}，其中 folder 为 "
            "{section,folder_id,name} 或 null。筛选发生在 100 条上限之前。"
        ),
        parameters=object_schema(
            {
                "section": {
                    "type": "string",
                    "enum": ENTITY_SECTIONS,
                    "description": "实体节；只接受这六类，不接受单例配置节",
                },
                "folder_id": string_schema(
                    "只能逐字复制 twin.list_folders 返回中同一 section 的 "
                    "folder_id；不能填文件夹名字、实体 id 或 asset id"
                ),
            },
            ["section"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="twin.read_entity",
        description=(
            "按稳定 id 读取一个三维孪生实体的完整配置及文件夹身份。"
            "section 只接受六个实体节；返回 schema_version、section、id、"
            "config 和 folder，folder 为 {section,folder_id,name} 或 null。"
        ),
        parameters=object_schema(
            {
                "section": {
                    "type": "string",
                    "enum": ENTITY_SECTIONS,
                    "description": "实体节；逐字复制名片上的 section",
                },
                "id": string_schema("逐字复制 twin.list_entities 名片上的 id"),
            },
            ["section", "id"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="twin.read_config",
        description=(
            "读取当前未保存三维孪生的单例配置。section 只取 model/viewpoints/"
            "roam，且不接收 id 或 folder_id；实体详情使用 twin.read_entity。"
        ),
        parameters=object_schema(
            {
                "section": {
                    "type": "string",
                    "enum": SINGLETON_SECTIONS,
                    "description": "要读取的单例配置节",
                },
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
