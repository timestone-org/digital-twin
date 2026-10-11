"""工具返回语义与副作用目录；输入定义始终取自实际 ToolSpec。"""

from dataclasses import replace

from llmcore.tools.shapes import ToolSpec

OUTPUT_GUIDES = (
    (
        "skills.load",
        "ok、name、title、instructions、compatibility、resources；资源只给相对路径索引。",
    ),
    (
        "skills.read_resource",
        (
            "content、start_line、end_line、total_lines、has_more、next_l"
            "ine；有下一页时按 next_line 续读。"
        ),
    ),
    (
        "tools.describe",
        "name、description、input_schema、output、effect、runs_on、failure；只说明本轮可用工具。",
    ),
    (
        "plan.write",
        "规范化后的完整计划及各项状态；计划更新不代表业务动作已执行。",
    ),
    (
        "modules.catalog",
        "模块名片分页；指定 module_type 后返回配置字段、绑定槽、"
        "预设索引或指定预设。",
    ),
    ("points.list_sources", "当前用户可见的数据源名片与分页信息。"),
    (
        "points.search",
        "点位候选、匹配方式与降级状态；top-k 不是全集，"
        "候选不能直接视为已核对。",
    ),
    (
        "points.detail",
        "node_key 对应的点位身份、类型、单位、地址及采样归档设置。",
    ),
    (
        "points.resolve",
        "每个 node_key 的解析结果，区分找到、缺失与不可用；保持输入对应关系。",
    ),
    (
        "assets.search",
        "素材名片分页，含 kind 与可直接写配置的 ref；ref 与 id 不可互换。",
    ),
    ("dashboards.list", "大屏名片及分页信息；使用返回的真实 id。"),
    ("dashboard.validate", "已保存大屏的校验结果；不代表浏览器草稿已保存。"),
    (
        "formula.catalog",
        "按 section 返回函数、列、台账或公式库的分页目录和求值口径。",
    ),
    ("formula.validate", "公式语法、引用依赖及循环校验；有问题时修正表达式。"),
    (
        "formula.preview",
        (
            "样例 value 与 history_refs；history_refs 在本次试算按空处理"
            "，不是真实取数结果。"
        ),
    ),
    ("datasets.list_tables", "台账名片和分页信息。"),
    ("datasets.read_columns", "指定台账已保存的列信息与分页结果。"),
    (
        "memory.remember",
        "已保存的记忆结果；嵌入不可用时明确标记，仅保存当前用户的记忆。",
    ),
    (
        "memory.search",
        "当前用户的记忆候选与检索可用状态；不能替代业务数据读取。",
    ),
    ("knowledge.list_bases", "当前用户可见的知识库及分页信息。"),
    (
        "knowledge.search",
        "资料片段、document_title 与 locator；结论引用必须对应召回证据。",
    ),
    ("user.ask", "用户选择、自由输入或取消结果；取消不表示同意。"),
    ("dataset.read_columns", "当前台账页面的列定义。"),
    (
        "dataset.propose_formula",
        "交给用户的公式提议；不代表用户已采用或已保存。",
    ),
    (
        "dashboard.read_canvas",
        "当前画布摘要、可寻址对象和选中项；详细配置由读取工具获取。",
    ),
    (
        "dashboard.read_bindings",
        "目标对象的槽位与绑定；空槽位和未读取必须区分。",
    ),
    (
        "dashboard.write_binding",
        "绑定写入草稿的回执；实时生效需保存并读回数值。",
    ),
    (
        "dashboard.save",
        "整份草稿保存结果；冲突或结果未知时先重新读取状态，不重复保存。",
    ),
    (
        "dashboard.read_values",
        "各槽位的实时状态和值；区分 has_value、waiting、unavailable、unbound。",
    ),
    (
        "dashboard.copy_bindings",
        "复制预览或实际结果、匹配项与跳过项；dry_run 不写入。",
    ),
    ("dashboard.remove_binding", "删除绑定的草稿回执；确认目标范围后调用。"),
    ("dashboard.add_module", "新增模块的实际身份；后续操作沿用返回的 id。"),
    ("dashboard.remove_node", "删除画布节点的草稿回执。"),
    ("dashboard.set_geometry", "几何修改的实际结果，可能经过边界归一化。"),
    ("dashboard.arrange", "参与排版的对象与执行结果；用截图核验布局。"),
    ("dashboard.capture", "当前画面图片，截图失败不代表画面为空。"),
    ("dashboard.read_config", "目标模块的实际配置。"),
    ("dashboard.add_config_item", "数组配置新增项及实际配置结果。"),
    ("dashboard.remove_config_item", "删除数组项的结果，可能改变后续索引。"),
    ("dashboard.chrome_keys", "可用外观字段、类型与含义。"),
    (
        "dashboard.set_config",
        "配置更新的实际结果；不支持的键或形状应先查模块目录。",
    ),
    ("dashboard.apply_style", "样式批量修改的实际结果；视觉任务以截图核验。"),
    ("report.read_draft", "当前报告模板、指标、正文及页面设置草稿。"),
    ("report.set_template", "更新后的模板草稿结果。"),
    ("report.upsert_metric", "新增或更新指标后的草稿结果。"),
    ("report.insert_content", "插入正文节点后的草稿结果。"),
    ("report.set_page", "页面配置修改的草稿结果。"),
    ("report.validate_draft", "报告草稿校验结果；错误项未修复不得宣称可生成。"),
    (
        "report.preview_draft",
        "指定周期的试算结果与问题；不等于正式报告已生成。",
    ),
    (
        "twin.list_folders",
        "schema_version、文件夹名片及分页；身份为 section + folder_id。",
    ),
    (
        "twin.list_entities",
        (
            "实体名片、applied_folder_id 和分页；空 folder_id 表示跨文件"
            "夹包含根目录。"
        ),
    ),
    ("twin.read_entity", "指定 section + id 的完整 config 与所属文件夹。"),
    ("twin.read_config", "model、viewpoints 或 roam 单例配置。"),
    ("twin.patch_config", "归一化后的实际配置；对象深合并、数组完整替换。"),
    ("twin.diagnose", "三维孪生草稿的问题清单；零问题只证明检查项通过。"),
    ("dashboard.read_interactions", "当前联动规则、对象与状态。"),
    ("dashboard.write_interaction", "新增或修改联动规则的草稿回执。"),
    ("dashboard.remove_interaction", "删除联动规则的草稿回执。"),
    ("dashboard.set_visible", "运行态显隐结果；不更改持久化配置。"),
    ("dashboard.read_page_style", "整屏外观缺省配置。"),
    ("dashboard.set_page_style", "整屏外观草稿修改结果。"),
    ("twin2d.read_config", "二维孪生配置或筛选后的实体分页。"),
    ("twin2d.patch_config", "二维孪生归一化后的实际草稿配置。"),
    ("twin2d.diagnose", "二维孪生草稿的问题清单。"),
)

READ_TOOLS = frozenset(
    {
        "skills.load",
        "skills.read_resource",
        "tools.describe",
        "modules.catalog",
        "points.list_sources",
        "points.search",
        "points.detail",
        "points.resolve",
        "assets.search",
        "dashboards.list",
        "dashboard.validate",
        "formula.catalog",
        "formula.validate",
        "formula.preview",
        "datasets.list_tables",
        "datasets.read_columns",
        "memory.search",
        "knowledge.list_bases",
        "knowledge.search",
        "dataset.read_columns",
        "dashboard.read_canvas",
        "dashboard.read_bindings",
        "dashboard.read_values",
        "dashboard.capture",
        "dashboard.read_config",
        "dashboard.chrome_keys",
        "report.read_draft",
        "report.validate_draft",
        "report.preview_draft",
        "twin.list_folders",
        "twin.list_entities",
        "twin.read_entity",
        "twin.read_config",
        "twin.diagnose",
        "dashboard.read_interactions",
        "dashboard.read_page_style",
        "twin2d.read_config",
        "twin2d.diagnose",
    }
)


def output_of(name: str) -> str:
    return next(
        (body for key, body in OUTPUT_GUIDES if key == name),
        "外部工具的结果内容；按内容标明的错误和执行状态判断，不据工具调用本身认定成功。",
    )


def effect_of(name: str) -> str:
    if name in READ_TOOLS:
        return "只读，不改变业务状态"
    special = {
        "plan.write": "保存会话计划",
        "memory.remember": "写入当前用户的长期记忆",
        "user.ask": "等待用户选择",
        "dataset.propose_formula": "生成待用户采用的提议",
        "dashboard.save": "保存整份草稿，包括用户尚未保存的修改",
        "dashboard.set_visible": "更改运行态显隐",
        "dashboard.copy_bindings": "dry_run=true 只预览；false 修改草稿",
        "dashboard.set_page_style": "更改整屏外观草稿，不在撤销栈中",
        "dashboard.write_interaction": "更改联动草稿，不在撤销栈中",
        "dashboard.remove_interaction": "删除联动草稿，不在撤销栈中",
    }
    return special.get(
        name,
        (
            "外部工具，以确认政策为准"
            if name.startswith("mcp.")
            else "修改当前页面草稿，保存与撤销能力以工具说明为准"
        ),
    )


def describe_tool(specs: tuple[ToolSpec, ...], name: str) -> dict[str, object]:
    spec = next((one for one in specs if one.name == name), None)
    if spec is None:
        raise ValueError("本轮没有这个工具，请使用当前工具清单中的规范名")
    return {
        "name": name,
        "description": spec.description,
        "input_schema": spec.parameters,
        "output": output_of(name),
        "effect": effect_of(name),
        "runs_on": spec.runs_on,
        "is_exclusive": spec.is_exclusive,
        "failure": (
            "code 与 next_action 指明恢复步骤；invalid_arguments 且 not_s"
            "tarted 可修参重调，unknown 写结果须先读回核验。"
        ),
    }


def with_guides(spec: ToolSpec) -> ToolSpec:
    return replace(
        spec,
        description=(
            f"{spec.description}\n执行位置：{spec.runs_on}；影响：{effect_of(spec.name)}。"
            f"\n输出：{output_of(spec.name)}\n失败时按提示修正；"
            "完整契约可查询 tools.describe。"
        ),
    )
