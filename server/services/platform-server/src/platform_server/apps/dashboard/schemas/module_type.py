"""模块清单的对外形状 —— Agent 生成大屏时的地图。

⚠ 清单的**唯一真源在前端**（渲染组件与它同处一地才不会漂），服务端这份是
构建期导出的产物；两侧一致性由 tests/contract 锁死（ADR-0012 五）。
"""

from typing import Any, Literal

from pydantic import Field

from platform_server.apps.dashboard.schemas.common import OutputModel

ConfigFieldType = Literal[
    "array", "boolean", "color", "enum", "number", "object", "range", "string"
]
ConfigFieldSpan = Literal["full", "half"]
BindingDataType = Literal["boolean", "enum", "number", "string"]
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
    array_fields: list["BindingSpecOut"] | None = None
    is_time_series: bool = False


class ModuleTypeOut(OutputModel):
    """一个模块类型的清单，即前端 manifest 中与渲染无关的那部分。"""

    type: str
    display_name: str
    category: str
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


class ModuleCatalogOut(OutputModel):
    """整份模块清单。"""

    catalog_version: int
    modules: list[ModuleTypeOut]
