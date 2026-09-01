"""算子目录的出参。

⚠ 它必须**完整**：只吐参数 schema 而不吐端口的话，前端画布拿不到端口信息，
只能自己硬编码一份端口拓扑（docs/MODELING_DESIGN.md D15）。
"""

from typing import Any

from pydantic import Field

from platform_server.apps.modeling.schemas.common import OutputModel


class PortOut(OutputModel):
    """一个端口。`contract` 是唯一的类型判据。"""

    name: str
    contract: str
    label: str
    is_required: bool
    description: str


class OperatorOut(OutputModel):
    """一个算子的完整对外描述。前端算子面板与参数表单都由它驱动。"""

    code: str
    name: str
    description: str
    category: str
    spec_version: str
    icon: str
    inputs: list[PortOut]
    outputs: list[PortOut]
    config_schema: dict[str, Any] = Field(default_factory=dict[str, Any])
    fit_required: bool
    serving_enabled: bool
    serving_window_required: bool
    serving_channel: str
