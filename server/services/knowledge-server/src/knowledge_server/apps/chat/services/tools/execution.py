"""知识库范围拒绝与公共工具执行器之间的适配。"""

from typing import Any

from knowledge_server.apps.chat.services.scope import BaseOutOfScope
from llmcore.tools.execution import failure
from llmcore.tools.registry import ToolRegistry
from llmcore.turn.loop import ServerToolRunner


def scoped_runner(registry: ToolRegistry) -> ServerToolRunner:
    async def run(name: str, arguments: dict[str, Any]) -> Any:
        try:
            return await registry.run(name, arguments)
        except BaseOutOfScope as error:
            raise failure(
                "out_of_scope",
                str(error),
                "先列出范围内的库；需要其它库时由用户修改会话范围。",
            ) from error

    return run
