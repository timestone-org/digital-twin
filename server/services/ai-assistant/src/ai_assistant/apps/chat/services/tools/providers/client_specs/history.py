"""历史绑定的工具入参；字段形状在浏览器转换为绑定契约。"""

from typing import Any

from llmcore.tools.shapes import integer_schema, object_schema, string_schema


def history_parameters() -> dict[str, Any]:
    """大屏时序槽的归档与台账来源参数。"""
    return {
        "dataset_key": string_schema(
            "台账列身份 ds:<表code>:<列key>，先查 datasets 工具"
        ),
        "range": object_schema(
            {
                "last_window": string_schema(
                    "正数相对窗，如 1h / 7d / 365d，与绝对窗二选一"
                ),
                "from_ms": integer_schema(
                    "绝对窗起点，UTC 毫秒；须同时给 to_ms 且起点小于终点"
                ),
                "to_ms": integer_schema("绝对窗终点，UTC 毫秒"),
            },
            [],
        ),
        "aggregate": {
            "type": "string",
            "enum": ["avg", "max", "min", "sum", "count"],
            "description": "只适用于 archive；依据指标含义选择，缺省 avg",
        },
        "interval": string_schema(
            "只适用于 archive；分桶档位如 1m / 15m / 1h / 1d，省略自动选档"
        ),
        "timezone": string_schema(
            "只适用于 archive；IANA 日界时区，如 Asia/Shanghai"
        ),
    }
