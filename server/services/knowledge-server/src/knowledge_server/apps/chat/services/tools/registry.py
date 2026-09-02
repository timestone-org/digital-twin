"""知识库对话这一套接了哪几路工具。

注册表本身（装配、查重名、按名字分派）在 `llmcore.tools.registry`；这里只回答
「知识库对话接了哪几路、各自要什么资源」。

⚠ 顺序是契约：知识库那一路在前、客户端那一路在后。它决定工具在提示词里的
先后，而先后影响模型的第一反应。
"""

from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.services.tools.client import ClientTools
from knowledge_server.apps.chat.services.tools.knowledge import (
    KnowledgeTools,
)
from knowledge_server.apps.knowledge.services.retrieval import (
    RetrievalStrategy,
)
from llmcore.tools.registry import ToolRegistry, registry_of

# 开一个事务的那件东西。⚠ 收工厂而不是收一个已开的会话：工具在回合循环里跑，
# 而循环跑在请求作用域那个会话收摊之后
Sessions = Callable[[], AbstractAsyncContextManager[AsyncSession]]


@dataclass(frozen=True)
class ToolDeps:
    """造一份注册表要的那几样资源。

    ⚠ 打成一包而不是逐个形参：每接一路来源就多一两格，而调用面的形参上限是 5。
    加一路 = 这里加一格。
    """

    sessions: Sessions
    # 这一次能用的那几种检索策略；由装配层按启动探测算好
    strategies: tuple[RetrievalStrategy, ...]


def build_registry(deps: ToolDeps) -> ToolRegistry:
    """知识库对话的工具注册表。

    Args: deps。
    """
    return registry_of(
        (
            KnowledgeTools(sessions=deps.sessions, strategies=deps.strategies),
            ClientTools(),
        )
    )
