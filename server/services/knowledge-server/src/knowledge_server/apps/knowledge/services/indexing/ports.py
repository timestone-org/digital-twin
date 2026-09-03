"""层 5 索引的扩展点：向量与关键词各存哪、各怎么查。

加一路索引 = 加一个实现文件 + 注册表里一行 + 一条契约测试（ADR-0029）。

⚠ **`kb_chunk_embeddings.embedding`（`vector(N)`）是唯一的向量存储**
（ADR-0045）：没有第二份 bytea 真相，也没有回退档。重建索引不必重算向量——
数据就在那一列上，`REINDEX` 读的也是它。

⚠ 打分**只排序不取舍**，并把「为什么它排在这」（`why`）一并交出去：
得分为 0 的候选一律不返回。硬凑几条出来的话，模型会以为「就这些了」然后从
里面挑一条——那比返回空表难查得多（与点位召回同源）。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class Scored:
    """一条召回：块 id、分数，以及它凭什么排在这。"""

    chunk_id: uuid.UUID
    score: float
    why: str


@dataclass(frozen=True)
class VectorRows:
    """一批要落库的向量。

    ⚠ 打成一包而不是逐个形参：调用面的形参上限是 5，而这里天然要
    「哪个库、哪一路算的、几维、哪些块」四件事。
    """

    base_id: uuid.UUID
    model: str
    dimensions: int
    rows: tuple[tuple[uuid.UUID, list[float]], ...]


@dataclass(frozen=True)
class VectorQuery:
    """一次向量检索。"""

    base_id: uuid.UUID
    vector: list[float]
    limit: int


@dataclass(frozen=True)
class KeywordQuery:
    """一次关键词检索。"""

    base_id: uuid.UUID
    text: str
    limit: int


@runtime_checkable
class VectorIndex(Protocol):
    """向量那一路。"""

    @property
    def name(self) -> str:
        """这一路在注册表里的名字。⚠ 会如实报进 `/capabilities`：
        走在回退档上时用户要看得见。"""
        ...

    async def upsert(self, session: AsyncSession, rows: VectorRows) -> None:
        """把一批向量写进去。

        ⚠ 一个块只有一条向量：重复写要覆盖而不是追加。留两条的话检索会把
        同一段话召回两次，而两条里哪一条是新的从外面看不出来。

        Args: session, rows。
        """
        ...

    async def search(
        self, session: AsyncSession, query: VectorQuery
    ) -> list[Scored]:
        """查最像的几条，按分数降序。

        Args: session, query。
        """
        ...


@runtime_checkable
class KeywordIndex(Protocol):
    """关键词那一路。

    ⚠ 它答的是「就是这个词」，而向量那一路答的是「意思像」。工业资料里两者
    缺一不可：「K1 机组」「GB/T 4728」这类编号在向量空间里几乎没有区分度，
    而「怎么判断轴承要换了」这类问法一个关键词都对不上。
    """

    @property
    def name(self) -> str:
        """这一路在注册表里的名字。"""
        ...

    async def search(
        self, session: AsyncSession, query: KeywordQuery
    ) -> list[Scored]:
        """查最像的几条，按分数降序。

        Args: session, query。
        """
        ...


def ranked(rows: Sequence[Scored], limit: int) -> list[Scored]:
    """按分数降序取前几条，**丢掉零分**。

    ⚠ 零分不是「弱相关」，是「一点都不沾边」。留着它们的话，一次问不到的
    提问也会返回满满一屏候选，而调用方会从里面挑一条。

    Args: rows, limit。
    """
    hit = [one for one in rows if one.score > 0.0]
    hit.sort(key=lambda one: one.score, reverse=True)
    return hit[:limit]
