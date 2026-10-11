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
            "用设备编号和测量量短词跨来源查点位，返回真实身份、来源和降级状态；歧义先请用户选择。"
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
        description=(
            "为一个已确认的真实 node_key 打开只读实时卡片；多选逐个"
            "调用，回执不代表已收到现场值。"
        ),
        parameters=object_schema(
            {"node_key": string_schema("搜索结果中的点位身份，原样传入")},
            ["node_key"],
        ),
        runs_on="client",
    ),
)
