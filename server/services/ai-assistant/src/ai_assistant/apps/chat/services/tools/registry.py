"""这套部署接了哪几路工具来源。

注册表本身（装配、查重名、按名字分派）在 `llmcore.tools.registry`；这里只回答
「助手这一套接了哪几路、各自要什么资源」。

⚠ provider 的生命期分两种：`ServerTools` **按请求造**（它握着这一次要转发的身份
头，做成进程级单例会让两个用户互相借用对方的身份），`ClientTools` 无状态。所以
注册表本身也按请求造。
"""

from dataclasses import dataclass

from ai_assistant.apps.chat.services.memory.longterm import (
    PgLongTermStore,
    SessionFactory,
)
from ai_assistant.apps.chat.services.tools.providers.client import ClientTools
from ai_assistant.apps.chat.services.tools.providers.knowledge import (
    KnowledgeTools,
)
from ai_assistant.apps.chat.services.tools.providers.mcp import McpTools
from ai_assistant.apps.chat.services.tools.providers.memory import MemoryTools
from ai_assistant.apps.chat.services.tools.providers.server import ServerTools
from ai_assistant.llm import EmbeddingAdapter
from ai_assistant.upstream import KnowledgeClient, McpCatalog, PlatformClient
from llmcore.tools.ports import ToolProvider
from llmcore.tools.registry import ToolRegistry, registry_of
from llmcore.tools.shapes import ToolSpec


@dataclass(frozen=True)
class ProviderDeps:
    """造一份注册表要的那几样资源。

    ⚠ 打成一包而不是逐个形参：每接一路来源就多一两格，而调用面的形参上限是 5
    （code-style-python）。到顶那天最省事的改法是把新资源塞进已有的某一格里，
    而那正是让两路来源开始互相知道对方的第一步。加一路 = 这里加一格。
    """

    # 上游业务面与这一次要转发的身份头
    platform: PlatformClient | None = None
    headers: dict[str, str] | None = None
    # 外部工具目录；不给即这一路缺席
    mcp: McpCatalog | None = None
    write_allowed: frozenset[str] = frozenset()
    # 长期记忆的仓储与嵌入档
    sessions: SessionFactory | None = None
    embedder: EmbeddingAdapter | None = None
    # 知识库的读侧；不给即这一路缺席（这套部署没起 knowledge-server）
    knowledge: KnowledgeClient | None = None


def build_registry(deps: ProviderDeps | None = None) -> ToolRegistry:
    """这套部署的工具注册表。

    ⚠ 顺序是契约：服务端那一路在前，长期记忆居中，客户端那一路在后。它决定
    工具在提示词里的先后，而先后影响模型的第一反应（`intent/select.py` 有一条
    闸守着原序）。

    ⚠ `sessions` 不给时长期记忆那两个工具**照样进规格表**。这是刻意的：
    `TOOL_SPECS` 是不带请求上下文取的一份静态清单（`all_specs`），而下发给模型
    的那一份按它过滤——按 `sessions` 有无来增删规格，会让「装配期看得见、
    运行期看不见」两份清单漂开，那比一句说得清的错更难查。没接上仓储时由
    `MemoryTools.run` 抛一句点名的错。

    ⚠ **MCP 那一路排在最末尾**，这不是审美。它的规格逐轮可变（某一路连不上时
    它的工具这一轮就不在），排在前面的话，一路 MCP 抖一下会让后面所有内建工具的
    声明整体位移——而工具声明属于前缀缓存唯一能命中的那一段（ADR-0025 的 B 层）。
    放在最末尾，抖动只影响它自己那一截。

    Args: deps（这几路来源各自要的资源；不给即只取得出规格那一份）。
    """
    given = deps if deps is not None else ProviderDeps()
    headers = dict(given.headers or {})
    providers: list[ToolProvider] = [
        ServerTools(platform=given.platform, headers=headers),
        MemoryTools(
            store=(
                None
                if given.sessions is None
                else PgLongTermStore(
                    sessions=given.sessions, embedder=given.embedder
                )
            ),
            headers=headers,
        ),
        # ⚠ 排在长期记忆之后、客户端之前。顺序是契约：它决定工具在提示词里的
        # 先后，而先后影响模型的第一反应（`intent/select.py` 有一条闸守着原序）
        KnowledgeTools(client=given.knowledge, headers=headers),
        ClientTools(),
    ]
    # ⚠ MCP 排在最后：它的规格逐轮才知道，而工具声明属于前缀缓存唯一能命中的
    # 那一段（ADR-0025 的 B 层）——排在前面会让后面所有内建工具的声明整体位移
    if given.mcp is not None and given.mcp.servers:
        providers.append(
            McpTools(catalog=given.mcp, write_allowed=given.write_allowed)
        )
    return registry_of(tuple(providers))


def all_specs() -> tuple[ToolSpec, ...]:
    """全部工具的规格，与执行用的那一份**同源**。

    ⚠ 不带上游造一个注册表来取：规格不依赖请求上下文，依赖了的话这一份静态清单
    与实际下发的那一份就会漂开，而两边都不报错。这条由契约测试守。
    """
    return build_registry().specs
