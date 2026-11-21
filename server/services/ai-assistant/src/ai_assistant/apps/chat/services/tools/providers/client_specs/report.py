"""报告模板编辑器执行的客户端工具规格。"""

from llmcore.tools.shapes import (
    ToolSpec,
    integer_schema,
    object_schema,
    string_schema,
)

REPORT_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="report.read_content",
        description="按正文提纲中的path读取完整文本窗口，沿next_offset续读。can_replace_text表明是否支持保留格式的文本替换。",
        parameters=object_schema(
            {
                "path": string_schema("来自report.read_draft的正文路径"),
                "offset": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "首次0，续读next_offset",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 8000,
                    "description": "文本字符数，默认4000",
                },
            },
            ["path"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="report.replace_text",
        description="修改已有同一格式的段落或标题，只改草稿。必须先读完整原文并作为expected_text；原文已变化时拒绝，复杂混合格式在正文编辑器修改。",
        parameters=object_schema(
            {
                "path": string_schema("来自report.read_draft的段落或标题路径"),
                "expected_text": string_schema(
                    "本次读取的完整原文，防止覆盖并发编辑"
                ),
                "text": {
                    "type": "string",
                    "maxLength": 16000,
                    "description": "替换文本；空串清空段落内容",
                },
            },
            ["path", "expected_text", "text"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="report.read_draft",
        description=(
            "读取当前未保存的报告草稿：模板信息、指标、页面设置，以及有界的"
            "正文提纲。沿document.next_offset续读到has_more=false；正文详情使用read_content。"
        ),
        parameters=object_schema(
            {
                "offset": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "提纲窗口起点，首次0",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 20,
                    "description": "提纲每页条数，默认20",
                },
            },
            [],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="report.set_template",
        description=(
            "局部修改报告模板的名称、说明、报告期粒度或启用状态，只改给出的字段"
            "并保留其它未保存草稿。"
        ),
        parameters=object_schema(
            {
                "name": string_schema("模板名称"),
                "description": string_schema("模板说明；空串表示清空"),
                "granularity": {
                    "type": "string",
                    "enum": ["day", "month", "quarter", "year"],
                    "description": "报告期粒度",
                },
                "is_enabled": {
                    "type": "boolean",
                    "description": "是否启用模板",
                },
            },
            [],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="report.upsert_metric",
        description=(
            "按 name 新增或替换一条报告指标，只改未保存草稿。非 expr 指标必须给"
            "真实 table 与 key；expr 指标必须给 expr。offset=0 本期，-1 上期。"
        ),
        parameters=object_schema(
            {
                "name": string_schema("模板内唯一的指标名"),
                "mode": {
                    "type": "string",
                    "enum": ["latest", "at_bucket", "window_agg", "expr"],
                    "description": "取数方式",
                },
                "table": string_schema("台账 code；非 expr 必给"),
                "key": string_schema("台账列 key；非 expr 必给"),
                "agg": {
                    "type": "string",
                    "enum": [
                        "avg",
                        "min",
                        "max",
                        "last",
                        "first",
                        "sum",
                        "count",
                        "delta",
                    ],
                    "description": "聚合方式；window_agg 必给",
                },
                "offset": integer_schema("报告期偏移，缺省 0"),
                "expr": string_schema("指标表达式；mode=expr 时必给"),
                "unit": string_schema("展示单位，可省"),
                "window": string_schema("取数窗口，如 1d、12mo，可省"),
                "anchor": {
                    "type": "string",
                    "enum": ["period", "latest"],
                    "description": "窗口锚点，缺省 period",
                },
            },
            ["name", "mode"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="report.insert_content",
        description=(
            "在报告编辑器当前光标插入标题、段落、指标数字、条件文本、单序列图表"
            "或台账表格，只改未保存草稿。数据节点的 table/key 必须取自"
            "台账目录。"
        ),
        parameters=object_schema(
            {
                "kind": {
                    "type": "string",
                    "enum": [
                        "paragraph",
                        "heading",
                        "metric_ref",
                        "conditional_text",
                        "line_chart",
                        "bar_chart",
                        "data_table",
                    ],
                    "description": "要插入的内容类型",
                },
                "text": string_schema("段落或标题文字"),
                "level": integer_schema("标题级别 1–6，缺省 2"),
                "expression": string_schema("指标或条件表达式"),
                "precision": integer_schema("指标小数位 0–10，缺省 2"),
                "title": string_schema("图表或表格标题"),
                "table": string_schema("台账 code"),
                "key": string_schema("台账列 key"),
                "series_name": string_schema("图例名称，缺省使用 key"),
                "window": string_schema("取数窗口；空或省略表示整个报告期"),
                "limit": integer_schema("表格行数上限 1–1000，缺省 100"),
            },
            ["kind"],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="report.set_page",
        description=(
            "局部修改报告页面设置，只改给出的字段并保留其它草稿。空的 "
            "watermark_text 会清除水印；空的页眉页脚表示清空。"
        ),
        parameters=object_schema(
            {
                "size": {
                    "type": "string",
                    "enum": ["A4", "A3", "Letter", "Legal"],
                    "description": "纸张尺寸",
                },
                "orientation": {
                    "type": "string",
                    "enum": ["portrait", "landscape"],
                    "description": "纸张方向",
                },
                "font_family": string_schema("正文字体"),
                "font_size_pt": {"type": "number", "description": "正文字号"},
                "page_header": string_schema("页眉；空串表示清空"),
                "page_footer": string_schema("页脚；空串表示清空"),
                "is_toc_enabled": {
                    "type": "boolean",
                    "description": "是否生成目录",
                },
                "watermark_text": string_schema("水印文字；空串表示清除"),
                "margin_top_cm": {
                    "type": "number",
                    "description": "上边距厘米",
                },
                "margin_bottom_cm": {
                    "type": "number",
                    "description": "下边距厘米",
                },
                "margin_left_cm": {
                    "type": "number",
                    "description": "左边距厘米",
                },
                "margin_right_cm": {
                    "type": "number",
                    "description": "右边距厘米",
                },
            },
            [],
        ),
        runs_on="client",
    ),
    ToolSpec(
        name="report.validate_draft",
        description=(
            "用 platform 的模板校验器检查当前未保存草稿。改完必须调用；"
            "is_blocking 的问题修完之前不要声称完成。"
        ),
        parameters=object_schema({}, []),
        runs_on="client",
    ),
    ToolSpec(
        name="report.preview_draft",
        description=(
            "按报告期试算当前未保存草稿，并把结果同步显示到页面右侧。"
            "回执中的 warnings、is_stale、is_truncated 和空值必须如实说明。"
        ),
        parameters=object_schema(
            {"period": string_schema("与模板粒度匹配的报告期，如 2026-08")},
            ["period"],
        ),
        runs_on="client",
    ),
)
