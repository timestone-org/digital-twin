"""工具的形状、来源协议，与把几路装成一个注册表。"""

from llmcore.tools.ports import ToolProvider, UnknownTool
from llmcore.tools.registry import DuplicateTool, ToolRegistry, registry_of
from llmcore.tools.selection import specs_named
from llmcore.tools.shapes import ToolSpec

__all__ = [
    "DuplicateTool",
    "ToolProvider",
    "ToolRegistry",
    "ToolSpec",
    "UnknownTool",
    "registry_of",
    "specs_named",
]
