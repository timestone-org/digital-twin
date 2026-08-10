"""通用 CRUD 基类。只做数据访问，**不提交**——事务边界归 service 层。"""

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase

from lib.errors.base import FieldError, ValidationFailed


class CrudBase[ModelT: DeclarativeBase]:
    """一个 ORM 模型的基础数据访问。"""

    def __init__(self, model: type[ModelT]) -> None:
        self.model = model

    async def get(
        self, session: AsyncSession, entity_id: uuid.UUID
    ) -> ModelT | None:
        """按主键取一行。

        Args: session, entity_id。
        """
        return await session.get(self.model, entity_id)

    async def list_page(
        self,
        session: AsyncSession,
        *,
        statement: Select[tuple[ModelT]],
        offset: int,
        limit: int,
    ) -> tuple[list[ModelT], int]:
        """取一页与总数。调用方负责构造过滤与排序。

        Args: session, statement, offset, limit。
        """
        total = await self.count(session, statement=statement)
        rows = await session.execute(statement.offset(offset).limit(limit))
        return list(rows.scalars().all()), total

    async def count(
        self, session: AsyncSession, *, statement: Select[tuple[ModelT]]
    ) -> int:
        """按同一份过滤条件计数。

        Args: session, statement。
        """
        subquery = statement.order_by(None).subquery()
        result = await session.execute(
            select(func.count()).select_from(subquery)
        )
        return int(result.scalar_one())

    def add(self, session: AsyncSession, entity: ModelT) -> ModelT:
        """把新实体挂进会话。取 id 用 flush，**不要 commit**。

        Args: session, entity。
        """
        session.add(entity)
        return entity

    async def delete(self, session: AsyncSession, entity: ModelT) -> None:
        """删除一行。

        Args: session, entity。
        """
        await session.delete(entity)

    @staticmethod
    def apply_changes(entity: ModelT, changes: dict[str, Any]) -> ModelT:
        """按字段名逐项赋值。调用方负责白名单，本函数不做校验。

        Args: entity, changes。
        """
        for key, value in changes.items():
            setattr(entity, key, value)
        return entity

    @staticmethod
    def order_by_whitelist(
        statement: Select[tuple[ModelT]],
        *,
        sort: str | None,
        allowed: dict[str, Any],
        default: Sequence[Any],
    ) -> Select[tuple[ModelT]]:
        """按白名单排序。白名单之外的字段直接 400，不静默忽略。

        Args: statement, sort（`-created_at,name`）, allowed, default。
        """
        if not sort:
            return statement.order_by(*default)
        columns: list[Any] = []
        for raw in sort.split(","):
            token = raw.strip()
            descending = token.startswith("-")
            name = token[1:] if descending else token
            column = allowed.get(name)
            if column is None:
                raise ValidationFailed(
                    "不支持按该字段排序",
                    details=(
                        FieldError(
                            field="sort",
                            code="unsupported_sort_field",
                            message=f"不支持的排序字段：{name}",
                        ),
                    ),
                )
            columns.append(column.desc() if descending else column.asc())
        return statement.order_by(*columns)
