"""知识库对话工具的结果与恢复说明，输入形状取实际规格。"""

from dataclasses import replace

from llmcore.tools.execution import describe_tool as describe_contract
from llmcore.tools.shapes import ToolSpec

RESULTS = (
    (
        "kb.list_bases",
        "bases、total、note；仅含会话范围内的库，total 可能大于本页数量。",
    ),
    (
        "kb.search",
        (
            "hits、strategy、note；每条含系统 mark、chunk_id、库名、文"
            "档、定位与原文片段。"
        ),
    ),
    (
        "kb.read_chunk",
        "document_title、locator、heading_path、before、text、after；仍受会话范围约束。",
    ),
    (
        "collect.search_points",
        "items、sources 及检索说明；保留完整 node_key，用来源区分同名点位。",
    ),
    (
        "collect.watch_point",
        "只读卡片创建回执；数值与质量以实时卡片为准，不进入模型历史。",
    ),
    ("user.ask", "picked、free_text、is_cancelled；采集选择取消时不打开卡片。"),
    (
        "skills.load",
        "name、instructions、resources；正文单独加载，资源按需读取。",
    ),
    (
        "skills.read_resource",
        "content、行号、has_more、next_line；按 next_line 读取后续完整行。",
    ),
    (
        "tools.describe",
        "input_schema、output、runs_on、failure；查询本轮实际可用工具。",
    ),
)


def output_of(name: str) -> str:
    return next(
        (text for key, text in RESULTS if key == name), "以实际工具回执为准"
    )


def describe_tool(specs: tuple[ToolSpec, ...], name: str) -> dict[str, object]:
    return {
        **describe_contract(specs, name),
        "output": output_of(name),
        "effect": "只读查询或当前会话中的展示，不修改知识库和设备",
        "failure": (
            "invalid_arguments 修正参数；out_of_scope 请用户改范围；依"
            "赖失败按提示处理，不解释为空结果。"
        ),
    }


def with_guides(spec: ToolSpec) -> ToolSpec:
    return replace(
        spec, description=f"{spec.description}\n输出：{output_of(spec.name)}"
    )
