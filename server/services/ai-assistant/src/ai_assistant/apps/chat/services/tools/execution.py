"""助手业务工具说明接入共享的校验与执行机制。"""

import json
from dataclasses import dataclass
from typing import Any

from ai_assistant.apps.chat.services.tools.guides import (
    READ_TOOLS,
    describe_tool,
)
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

    async def run_with_budget(
        self, name: str, arguments: dict[str, Any], max_chars: int
    ) -> Any:
        if name not in READ_TOOLS or name in {
            "skills.load",
            "skills.read_resource",
            "tools.describe",
        }:
            return await super().run_with_budget(name, arguments, max_chars)
        available = max(1, max_chars - self.result_reserve_chars)
        given = dict(arguments)
        if name == "knowledge.read_chunk":
            spec = next((one for one in self.specs if one.name == name), None)
            if spec is not None:
                validate_arguments(spec, given)
            limit = given.get("limit", 4000)
            if type(limit) is int:
                given["limit"] = min(limit, max(1, available - 1024))
        result = await self(name, given)
        text = json.dumps(result, ensure_ascii=False)
        if len(text) > available:
            raise failure(
                "result_budget_exceeded",
                "本次完整读取结果超过上下文预算，未返回残缺内容",
                "缩小limit后读取；offset类保持原offset，page类改limit时从page=1重读并按身份去重。"
                "不可分页的详情需缩小任务范围或提高模型预算。",
                execution="completed",
            )
        return text


__all__ = [
    "ToolExecutionError",
    "ToolExecutor",
    "failure",
    "validate_arguments",
]
