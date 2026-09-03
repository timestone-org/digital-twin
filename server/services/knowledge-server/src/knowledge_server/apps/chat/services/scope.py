"""这次对话去哪几个库取数：范围的取值、解析，以及「准不准取」的判据。

范围钉在**会话**上，默认全部（ADR-0044）。它是用户给自己划的取数边界，
**不是权限**——`knowledge:use` 判的是「能不能用知识库」，范围回答的是
「这一次对话只看这几本手册」。两者混在一起的话，改一次范围就像在改授权。

⚠ 范围是**硬过滤**，不是提示词里的一句请求：提示词只是让模型知情，真正拦住
越界取数的是工具层每一次调用前的这一道判定。只写提示词的话，模型多数时候听话、
偶尔不听，而不听的那一次没有任何一处报错——用户看到的是一条来自他明确排除掉的
库的答案。

⚠ `None`（全部）与空集合（一个都没选）必须分得开，从库里的那一列一直到这里。
分不开的表现是「用户清空了选择，于是检索悄悄扩到了全部库」。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.errors import ChatScopeBaseUnknown
from knowledge_server.apps.knowledge.services import library_service


class BaseOutOfScope(LookupError):
    """要取的这个库不在这次对话的范围里。

    ⚠ 抛出去而不是回空表：空表与「这个库里确实没这句话」长得一模一样，模型会
    把它读成「查过了，没有」然后接着往下答。
    """


@dataclass(frozen=True)
class ScopeBase:
    """范围里的一个库。"""

    base_id: uuid.UUID
    # 库名；已经没有这个库时是空串
    name: str
    # ⚠ 库被删了也留在范围里，只是标成「已不存在」：从范围里抹掉等于替用户把
    # 边界改宽了，而他从界面上看不出来
    is_missing: bool


@dataclass(frozen=True)
class BaseScope:
    """这次对话能取哪几个库的数。`bases is None` = 全部知识库。"""

    bases: tuple[ScopeBase, ...] | None

    @property
    def is_all(self) -> bool:
        """不限库吗。"""
        return self.bases is None

    def ids(self) -> tuple[uuid.UUID, ...] | None:
        """范围里那几个库的 id；不限库时给 `None`。"""
        if self.bases is None:
            return None
        return tuple(one.base_id for one in self.bases)

    def allows(self, base_id: uuid.UUID) -> bool:
        """这个库在范围里吗。

        Args: base_id。
        """
        return self.bases is None or any(
            one.base_id == base_id for one in self.bases
        )

    def require(self, base_id: uuid.UUID) -> None:
        """不在范围里就抛。

        Args: base_id。
        """
        if self.allows(base_id):
            return
        raise BaseOutOfScope(
            "这次对话的范围里没有这个库；先调 kb.list_bases 看范围内有哪几个，"
            "要换库得让用户在输入框上方改范围"
        )


# 不限库。⚠ 会话行上那一列是 NULL 时读出来就是它：没划过范围 = 全都能查
ALL_BASES = BaseScope(bases=None)


async def resolve(
    session: AsyncSession, base_ids: Sequence[uuid.UUID] | None
) -> BaseScope:
    """把库里那一列解析成范围：补上库名，认不出的标成已不存在。

    Args: session, base_ids（None = 全部）。
    """
    made = await resolve_many(session, [base_ids])
    return made[0]


async def resolve_many(
    session: AsyncSession,
    listed: Sequence[Sequence[uuid.UUID] | None],
) -> list[BaseScope]:
    """一次解析一页会话的范围。

    ⚠ 库名一次问齐而不是逐条问：列表页一页 100 条，逐条问就是 100 次往返，
    而它只表现为「对话列表有点慢」。

    Args: session, listed（每条会话那一列，None = 全部）。
    """
    wanted = {one for ids in listed if ids is not None for one in ids}
    names = await library_service.base_names(session, sorted(wanted))
    return [_scope_of(ids, names) for ids in listed]


def _scope_of(
    base_ids: Sequence[uuid.UUID] | None, names: dict[uuid.UUID, str]
) -> BaseScope:
    """一条会话那一列 + 一份库名表 → 范围。

    Args: base_ids, names。
    """
    if base_ids is None:
        return ALL_BASES
    return BaseScope(
        bases=tuple(
            ScopeBase(
                base_id=one,
                name=names.get(one, ""),
                is_missing=one not in names,
            )
            for one in base_ids
        )
    )


async def checked(
    session: AsyncSession, base_ids: Sequence[uuid.UUID]
) -> list[uuid.UUID]:
    """写入面校验：去重、逐个确认存在，认不出就整笔拒。

    ⚠ 去重保序而不是拒绝重复：重复选中同一个库不改变边界，拒了只是刁难；
    但**认不出的 id 不许悄悄丢掉**，丢掉之后范围比用户划的宽。

    Args: session, base_ids。
    """
    wanted = list(dict.fromkeys(base_ids))
    names = await library_service.base_names(session, wanted)
    unknown = [one for one in wanted if one not in names]
    if unknown:
        listed = "、".join(str(one) for one in unknown)
        raise ChatScopeBaseUnknown(f"这几个知识库不存在：{listed}")
    return wanted
