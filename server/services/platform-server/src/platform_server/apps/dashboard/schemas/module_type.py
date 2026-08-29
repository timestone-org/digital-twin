"""模块清单的对外形状 —— Agent 生成大屏时的地图。

⚠ 清单的**唯一真源在前端**（渲染组件与它同处一地才不会漂），服务端这份是
构建期导出的产物；两侧一致性由 tests/contract 锁死（ADR-0012 五）。
"""

from typing import Any, Literal

from pydantic import Field

from platform_server.apps.dashboard.schemas.common import OutputModel

ConfigFieldType = Literal[
    "array",
    "boolean",
    "color",
    "dashboard-ref",
    "enum",
    "font",
    "image",
    "json",
    "number",
    "object",
    "range",
    "string",
    "style",
    "textarea",
]
ConfigFieldSpan = Literal["full", "half"]
BindingDataType = Literal["boolean", "enum", "number", "string"]
ChromeKeyType = Literal["boolean", "color", "enum", "number", "number3"]
ModuleChrome = Literal["bare", "card"]
ModuleRegion = Literal["footer", "header"]


class ModuleDefaultSizeOut(OutputModel):
    """拖进画布时的初始尺寸，与节点几何同一套设计坐标系（像素）。"""

    width: int
    height: int
    min_width: int | None = None
    min_height: int | None = None


class ConfigOptionOut(OutputModel):
    """`type: "enum"` 的一个可选项。"""

    value: Any = None
    label: str


class ConfigFieldConditionOut(OutputModel):
    """条件显示：同级字段的当前值落在 `in_values` 里才渲染本字段。"""

    key: str
    in_values: list[Any] = Field(
        validation_alias="in", serialization_alias="in"
    )


class ConfigFieldOut(OutputModel):
    """一个配置字段。属性面板按 `type` 选控件，没有针对具体模块的表单代码。"""

    key: str
    label: str
    type: ConfigFieldType
    # ⚠ 改 default 会改变**存量**大屏的渲染：没配过这个键的节点全都跟着变
    default: Any = None
    options: list[ConfigOptionOut] | None = None
    placeholder: str | None = None
    group: str | None = None
    help: str | None = None
    span: ConfigFieldSpan | None = None
    when: ConfigFieldConditionOut | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    item_schema: list["ConfigFieldOut"] | None = None
    item_label_key: str | None = None
    min_items: int | None = None
    max_items: int | None = None
    fields: list["ConfigFieldOut"] | None = None


class BindingSpecOut(OutputModel):
    """模块声明的一个数据入口。服务端读它校验 `field_key`。"""

    key: str
    label: str
    data_type: BindingDataType
    is_required: bool = False
    enum_map: dict[str, str] | None = None
    is_array: bool = False
    # 行钉在实体上：第 i 行喂配置里文档序第 i 个实体。⚠ 只有这种槽允许索引留空，
    # 见 `binding_rules._check_array_runs`
    is_entity_pinned: bool = False
    array_fields: list["BindingSpecOut"] | None = None
    is_time_series: bool = False


class ConfigPresetOut(OutputModel):
    """模块级「外观预设」：一次浅合并写入一整套 config 字段。

    ⚠ 与 `ConfigFieldOut.default` 的语义刻意不同：default 是**不落库**的渲染
    兜底，预设是用户（或 Agent）点了之后**显式落库**的一笔，未列出的键原样保留。
    有些观感是十几个字段的组合，逐个照抄必漏、漏了也看不出漏在哪。
    """

    id: str
    label: str
    hint: str | None = None
    # 逐键浅合并进 config 的值，可含 config_schema 之外的段
    # （`__cardStyle` 就是）
    config: dict[str, Any] = Field(default_factory=dict[str, Any])


class ModuleSubEditorOut(OutputModel):
    """某个 config 键由一个整页子编辑器接管。

    ⚠ 这一段的内部形状**不在清单里**：照猜着往 `config_key` 那一段里写，
    值存得下去、也不报错，画面上表现为「配了没反应」。
    """

    config_key: str
    route_name: str
    label: str
    hint: str | None = None


class CatalogTypeDocOut(OutputModel):
    """一档类型的一句话说明：值是什么形状、有哪个坑。

    给**模型**读的图例——属性面板按 `type` 选控件，模型没有控件可看，只能靠
    这一句知道该往配置里写什么形状的值。真源在前端契约的
    `CONFIG_FIELD_TYPE_DOCS` / `BINDING_DATA_TYPE_DOCS`。
    """

    type: str
    doc: str


class ChromeKeyOut(OutputModel):
    """卡片外壳词汇表里的一个键。

    ⚠ 这批键**不在任何模块的 `config_schema` 里**：它们住在模块配置的
    `__cardStyle` 段与大屏级 `chrome_json.card` 两处，对所有模块通用。铁律是
    「键不存在 = 未设置」，故 `values` 里不含「缺省档」——那一档是删键，
    不是一个可写的值。
    """

    key: str
    type: ChromeKeyType
    # 合法取值白名单，仅 `enum` 有。⚠ 写错档位存得下去、渲染时静默回落
    values: list[str] | None = None


class ModuleTypeOut(OutputModel):
    """一个模块类型的清单，即前端 manifest 中与渲染无关的那部分。"""

    type: str
    display_name: str
    category: str
    # 给模型读的一段说明：这是什么、什么时候改用哪个兄弟模块、槽怎么喂、
    # 真有的那条坑。
    # ⚠ 可选只为兼容第三方清单；内建模块缺了它，Agent 只能靠模块名猜它是干什么的
    description: str | None = None
    icon: str | None = None
    keywords: list[str] = Field(default_factory=list[str])
    default_size: ModuleDefaultSizeOut
    config_schema: list[ConfigFieldOut] = Field(
        default_factory=list[ConfigFieldOut]
    )
    bindings: list[BindingSpecOut] = Field(default_factory=list[BindingSpecOut])
    chrome: ModuleChrome = "card"
    is_container: bool = False
    region: ModuleRegion | None = None
    version: int = 1
    # 一次写一整套观感的按钮。少了它，Agent 只能逐个字段去凑同样的效果
    config_presets: list[ConfigPresetOut] = Field(
        default_factory=list[ConfigPresetOut]
    )
    # 新建节点时**显式落库**的出厂配置，与 `ConfigFieldOut.default` 的不落库兜底
    # 不是一回事：读一个新节点的配置时看得见它
    default_config: dict[str, Any] = Field(default_factory=dict[str, Any])
    sub_editor: ModuleSubEditorOut | None = None
    # 顶层配置键里属于**内容**的那几个（标题、格、阈值规则）。其余即观感键，
    # 一条卡片样式写的就是那一批。
    # ⚠ 只能逐模块声明，不能按键名或 `group` 通配：三个模块的缺值占位键名各不
    # 相同，而 group 是给人看的中文串，改一个字就会把内容键当观感键存进样式，
    # 套用时把用户配好的格整片抹掉——两侧都不报错。
    # ⚠ 缺省的 `None` 表示这个模块没声明过内容键，与「声明了空表」不是一回事
    content_keys: list[str] | None = None


class ModuleCatalogOut(OutputModel):
    """整份模块清单，外加三张读它要用的图例。"""

    catalog_version: int
    # ⚠ 图例摆在模块表之前：被上下文截断时，先没的不该是读表的图例
    field_types: list[CatalogTypeDocOut] = Field(
        default_factory=list[CatalogTypeDocOut]
    )
    binding_data_types: list[CatalogTypeDocOut] = Field(
        default_factory=list[CatalogTypeDocOut]
    )
    # 卡片外壳的键词汇表，对所有模块通用，故只挂在整表与详情上、不进模块表
    chrome_keys: list[ChromeKeyOut] = Field(default_factory=list[ChromeKeyOut])
    modules: list[ModuleTypeOut]


class ModuleTypeDetailOut(ModuleTypeOut):
    """一个模块的清单，外加三张图例。

    ⚠ 图例跟着**详情**走而不是只挂在整表上：Agent 要摆一个模块时只拉这一个，
    拉不到图例就只能猜 `type` 那一格是什么形状的值——而写错形状的值存得下去、
    也不报错。整表那一份是给「浏览有哪些模块」用的，两处都要有。
    """

    field_types: list[CatalogTypeDocOut] = Field(
        default_factory=list[CatalogTypeDocOut]
    )
    binding_data_types: list[CatalogTypeDocOut] = Field(
        default_factory=list[CatalogTypeDocOut]
    )
    chrome_keys: list[ChromeKeyOut] = Field(default_factory=list[ChromeKeyOut])
