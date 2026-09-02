"""知识库对话接了哪几路工具：知识库自己那一路（只读）与反问那一路（客户端）。"""

from knowledge_server.apps.chat.services.tools.registry import (
    ToolDeps,
    build_registry,
)

__all__ = ["ToolDeps", "build_registry"]
