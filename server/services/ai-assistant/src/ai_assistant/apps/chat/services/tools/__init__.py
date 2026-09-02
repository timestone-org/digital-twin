"""层 5 执行与工具：一批工具从哪来、怎么跑。

装配与分派那一半在 `llmcore.tools`；这里只多出「助手接了哪几路」。

⚠ 这一包对外只认这个再导出面。别的功能模块直接伸进子模块时结构闸**不会拦**
（它只判跨功能 import 路径的第 4 段是不是 `services`），只能靠这份清单与评审守。
"""

from ai_assistant.apps.chat.services.tools.registry import (
    ProviderDeps,
    all_specs,
    build_registry,
)
from llmcore.tools.ports import RunsElsewhere, ToolProvider, UnknownTool
from llmcore.tools.registry import DuplicateTool, ToolRegistry, registry_of

__all__ = [
    "DuplicateTool",
    "ProviderDeps",
    "RunsElsewhere",
    "ToolProvider",
    "ToolRegistry",
    "UnknownTool",
    "all_specs",
    "build_registry",
    "registry_of",
]
