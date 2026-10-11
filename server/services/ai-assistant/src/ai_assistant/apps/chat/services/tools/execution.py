"""助手业务工具说明接入共享的校验与执行机制。"""

from dataclasses import dataclass

from ai_assistant.apps.chat.services.tools.guides import describe_tool
from llmcore.tools.execution import (
    ToolDescriber,
    ToolExecutionError,
    failure,
    validate_arguments,
)
from llmcore.tools.execution import ToolExecutor as SharedToolExecutor


@dataclass(frozen=True)
class ToolExecutor(SharedToolExecutor):
    describe: ToolDescriber = describe_tool


__all__ = [
    "ToolExecutionError",
    "ToolExecutor",
    "failure",
    "validate_arguments",
]
