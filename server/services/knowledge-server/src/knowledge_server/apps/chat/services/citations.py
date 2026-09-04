"""这一回合发出去的角标，以及答案里真正用到的那几条。

⚠ **一回合一份**：工具注册表是按回合现造的（`advance_service` 里
`deps.tools(loaded.scope)`），所以这份账本天然是回合作用域的。做成模块级的
话，两个用户的两个回合在同一个进程里并发跑，后来的那个会把前一个的账本盖掉。

⚠ 扫不出角标 = **不出引用块**，而不是退回「把查到的都列出来」。后者正是这一
轮要改掉的样子：检索回执里那十来条，模型多半只用了两三条。
"""

import uuid
from collections.abc import Callable, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field, replace
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.services.markers import marker_of
from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.services import HitOut

# 开一个新事务的口子。⚠ 就地定义而不是从摄取那一侧借：对话这一层不该为了
# 一个类型别名去依赖摄取管线
Sessions = Callable[[], AbstractAsyncContextManager[AsyncSession]]


@dataclass(frozen=True)
class CitedFigure:
    """引用里带的一张图。⚠ 只带 id 与图注，不带字节：字节走取图端点，
    每一次都过一遍权限。"""

    id: uuid.UUID
    caption: str
    page: int | None


@dataclass(frozen=True)
class Cited:
    """一条被引到的召回，够引用面画出来。"""

    marker: str
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    base_name: str
    heading_path: str
    # 给人看的一句位置（「第 4–6 页 · 二、运行参数」）。⚠ 由后端拼：
    # 各端各拼一份一定会漂
    where: str
    page: int | None
    page_end: int | None
    text: str
    # 这一块的正文里出现的那几张图。⚠ 回合结束时才补：发角标那一刻不查，
    # 因为多数召回压根没被引到，为它们查图是白花的往返
    figures: tuple[CitedFigure, ...] = ()


@dataclass
class Ledger:
    """这一回合发过的角标。"""

    issued: list[Cited] = field(default_factory=list[Cited])

    def mark(self, hit: HitOut, base_name: str, text: str) -> str:
        """给这条召回发一个角标；同一块重复召回时复用原来那个。

        ⚠ 同一块在两次检索里都被召回是常事（换个说法再查一轮）。不复用的话，
        同一段话会拿到两个角标，而引用面上它出现两次。

        Args: hit, base_name, text。
        """
        for one in self.issued:
            if one.chunk_id == hit.chunk_id:
                return one.marker
        marker = marker_of(len(self.issued) + 1)
        self.issued.append(
            Cited(
                marker=marker,
                chunk_id=hit.chunk_id,
                document_id=hit.document_id,
                document_title=hit.document_title,
                base_name=base_name,
                heading_path=hit.heading_path,
                where=hit.locator.label,
                page=hit.locator.page,
                page_end=hit.locator.page_end,
                text=text,
            )
        )
        return marker

    def resolve(self, numbers: list[int]) -> list[Cited]:
        """把答案里扫到的那几个序号解析成召回。

        ⚠ 解析不出的序号**直接丢掉**：模型偶尔会写一个没发过的角标，而为它
        画一个点不动的空引用比不画更糟。

        Args: numbers。
        """
        return [
            self.issued[one - 1]
            for one in numbers
            if 1 <= one <= len(self.issued)
        ]


@dataclass(frozen=True)
class CitationsFound:
    """这一回合的答案里真的用到了这几条。

    ⚠ 一条都没用到时**不发这一帧**：发一个空表与「这次没有引用」在前端要
    分两种画法，而它们本来是同一件事。
    """

    items: tuple[Cited, ...]


async def with_figures(sessions: Sessions, items: list[Cited]) -> list[Cited]:
    """给被引到的那几条补上它们各自的图。

    ⚠ 只查**真被引到**的那几块：一次检索召十来条，模型多半只用两三条，
    为没被引到的那些查图是白花的往返。

    ⚠ 一次查完再按块分组，不逐条查（N+1）。

    Args: sessions（开事务的口子）, items。
    """
    if not items:
        return items
    async with sessions() as session:
        found = await crud.figure.figures_of_chunks(
            session, [one.chunk_id for one in items]
        )
    return [
        replace(
            one,
            figures=tuple(
                CitedFigure(id=fig.id, caption=fig.caption, page=fig.page)
                for fig in found.get(one.chunk_id, [])
            ),
        )
        for one in items
    ]


def as_json(items: Sequence[Cited]) -> list[dict[str, Any]]:
    """引用摊成线上那一份——`citations` 帧与落库那一列共用这一个形状。

    ⚠ 只有这一处：帧与落库各摊一遍的话，直播时画得出来的引用回放时会少一格，
    而两边单看都对。形状由 `schemas.ChatCitationOut` 钉着。

    ⚠ `where` 由后端拼好：各端各拼一份一定会漂，而这一句要与检索面上那一句
    逐字一致。

    Args: items。
    """
    return [
        {
            "marker": one.marker,
            "chunk_id": str(one.chunk_id),
            "document_id": str(one.document_id),
            "document_title": one.document_title,
            "base_name": one.base_name,
            "heading_path": one.heading_path,
            "where": one.where,
            "page": one.page,
            "page_end": one.page_end,
            "text": one.text,
            "figures": [
                {"id": str(fig.id), "caption": fig.caption, "page": fig.page}
                for fig in one.figures
            ],
        }
        for one in items
    ]
