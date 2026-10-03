"""MCP 写操作的部署政策；只接受已审核的业务资源种类。"""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

ResourceKind = Literal["dashboard", "dataset", "report"]
MAX_TOOL_NAME_LENGTH = 64
PERMISSION_PAIRS: tuple[tuple[ResourceKind, frozenset[str]], ...] = (
    ("dashboard", frozenset({"dashboard:view", "dashboard:edit"})),
    ("dataset", frozenset({"dataset:view", "dataset:manage"})),
    ("report", frozenset({"report:view", "report:manage"})),
)
TOOL_NAME = re.compile(
    r"^mcp\.[A-Za-z0-9][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9_-]*$"
)


class McpWritePolicyConfig(BaseModel):
    """管理员显式声明工具的业务授权、目标字段与影响。"""

    model_config = ConfigDict(extra="forbid", frozen=True)
    required_codes: frozenset[str]
    target_parameter: str = Field(
        min_length=1, max_length=64, pattern=r"^[A-Za-z][A-Za-z0-9_]*$"
    )
    impact: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def require_known_business_permissions(self) -> "McpWritePolicyConfig":
        """未知动作、模型管理和设备操作没有资源适配器，拒绝配置。"""
        if not any(
            self.required_codes == codes for _, codes in PERMISSION_PAIRS
        ):
            raise ValueError("MCP 写政策必须使用已支持的业务查看与写权限对")
        if not self.impact.strip():
            raise ValueError("MCP 写政策必须说明操作影响")
        return self

    @property
    def resource_kind(self) -> ResourceKind:
        """业务权限对对应的资源种类。"""
        for kind, codes in PERMISSION_PAIRS:
            if self.required_codes == codes:
                return kind
        raise ValueError("没有对应资源校验器的 MCP 写政策")


def parse_write_policies(given: str) -> dict[str, McpWritePolicyConfig]:
    """校验部署声明；没有配置时不给任何工具写授权。

    Args: given。
    """
    if not given.strip():
        return {}
    policies = TypeAdapter(dict[str, McpWritePolicyConfig]).validate_json(given)
    for name in policies:
        if (
            len(name) > MAX_TOOL_NAME_LENGTH
            or not TOOL_NAME.fullmatch(name)
            or "__" in name
        ):
            raise ValueError("MCP 写政策必须使用规范工具名 mcp.server.tool")
    return policies
