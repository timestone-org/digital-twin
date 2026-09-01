"""层 1 来源的扩展点：知识**从哪来**。

加一路来源 = 加一个实现文件 + 注册元组里一行 + 一条契约测试（ADR-0029）。

⚠ 这是最外面那一层，而不是「支持几种格式」（ADR-0033 决策一）。三年后
「支持几种格式」大概率还是那几种，而「知识从哪来」一定会长出第三路、第四路。

⚠ **上传那一路也走这个接口**，不给它开后门。开了后门的话，第二路来源要么
复制一遍摄取管线，要么把管线改成认两种形状的 `if`——而那个 `if` 会在第三路
出现时变成三个分支。

⚠ 外部系统那一路经对方的 **HTTP 面**拿数据，绝不读对方的库：抄一份别人的
数据进自己的库已经够危险，再绕过它的权限判定去抄，就等于用知识库当越权通道。
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from knowledge_server.apps.knowledge.services.parsing import RawItem


@dataclass(frozen=True)
class DiscoveredItem:
    """这一路来源里的一个条目。

    ⚠ `content_hash` 算得出就给、算不出留空：上传那一路在对象存储里拿得到
    校验和，外部系统那一路多半拿不到，由摄取阶段取回字节之后再算。
    """

    external_ref: str
    title: str
    media_type: str = ""
    byte_size: int = 0
    content_hash: str = ""


@dataclass(frozen=True)
class DiscoveredPage:
    """一次 `discover` 的结果。

    ⚠ `cursor` 为 `None` 即到底了。用「空表即到底」判的话，一次恰好返回空页
    的中间页会让同步提前收工，而表现是「有些文档一直没被摄取」。
    """

    items: tuple[DiscoveredItem, ...]
    cursor: str | None = None


class SourceUnavailable(RuntimeError):
    """这一路来源此刻拿不到东西（对方不可达 / 配置不对）。

    ⚠ 与「认不出这份原件」分开：前者重试有意义，后者重试一万次也一样。
    """


@runtime_checkable
class KnowledgeSource(Protocol):
    """一路知识来源。"""

    @property
    def kind(self) -> str:
        """这一路在注册表里的名字。⚠ 声明成只读属性而不是可写字段：
        实现一律是冻结 dataclass，而冻结字段满足不了可写的协议成员。"""
        ...

    def config_schema(self) -> Mapping[str, Any]:
        """这一路的配置形状，给界面渲染表单、也给入库前校验用。

        ⚠ 配置是一只自由袋子：写一个这一路不认识的键既不报错也不生效，
        画面上表现为「配了没反应」，而配置确实存下去了。所以入库前必须按
        这份 schema 校验过。
        """
        ...

    async def discover(
        self, config: Mapping[str, Any], cursor: str | None
    ) -> DiscoveredPage:
        """这一路现在有哪些条目，从游标处往后取一页。

        Args: config, cursor（`None` 即从头）。
        """
        ...

    async def fetch(self, config: Mapping[str, Any], ref: str) -> RawItem:
        """取一条的原件。

        Args: config, ref（`DiscoveredItem.external_ref`）。
        """
        ...
