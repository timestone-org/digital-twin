"""采集点位查找与实时卡片的客户端工具规格。"""

from llmcore.tools.shapes import ToolSpec, object_schema, string_schema

SEARCH_POINTS = "collect.search_points"
WATCH_POINT = "collect.watch_point"
COLLECT_TOOLS = (SEARCH_POINTS, WATCH_POINT)
POINT_QUERY_MAX_CHARS = 80

COLLECT_SPECS = (
    ToolSpec(
        name=SEARCH_POINTS,
        description=(
            "用设备名、编号和测量量这几个关键词查找采集点位，不扩写描述。"
            "使用向量与关键词混合检索。返回候选、来源和检索降级说明。"
            "标识只能来自结果；多项可能匹配时用 user.ask 确认。"
        ),
        parameters=object_schema(
            {
                "query": {
                    **string_schema(
                        "2–6个关键词，通常不超过40字，"
                        "例如：动力换热 2#阀门 开度。"
                        "保留设备编号；不要写用途、权限、背景介绍或实时显示要求。"
                    ),
                    "minLength": 1,
                    "maxLength": POINT_QUERY_MAX_CHARS,
                },
                "source_id": {
                    "description": (
                        "可选的数据源过滤。未知或未指定数据源时必须传null或省略；"
                        "不能猜测UUID，不能用全零UUID代替全部数据源。"
                        "非空值只能来自先前搜索结果的source_id。"
                    ),
                    "anyOf": [
                        {"type": "string", "format": "uuid"},
                        {"type": "null"},
                    ],
                },
            },
            ["query"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name=WATCH_POINT,
        description="打开一个持续接收采集数据的只读实时卡片。必须先查点位并消除歧义；不能猜测标识。回执仅表示卡片已创建，不代表已经收到现场读数；不要编造实时值。",
        parameters=object_schema(
            {"node_key": string_schema("搜索结果中的点位身份，原样传入")},
            ["node_key"],
        ),
        runs_on="client",
    ),
)
