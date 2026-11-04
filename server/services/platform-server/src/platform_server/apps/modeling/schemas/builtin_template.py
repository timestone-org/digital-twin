"""内置模板目录的公开元数据，不包含图或执行函数。"""

from typing import Literal

from platform_server.apps.modeling.schemas.common import OutputModel

type BuiltinTemplateCategory = Literal[
    "prediction", "detection", "analysis", "rule"
]
type BuiltinTemplateFilter = Literal[
    "all", "prediction", "detection", "analysis", "rule"
]


class BuiltinModelingTemplateOut(OutputModel):
    """一个内置模板的身份与用途说明。"""

    key: str
    label: str
    hint: str
    category: BuiltinTemplateCategory
