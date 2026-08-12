"""自定义类型定义的数据访问。"""

import uuid

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from opcua_server.apps.instance.models import TypeDefinition

SORTABLE = {
    "browse_name": TypeDefinition.browse_name,
    "kind": TypeDefinition.kind,
    "created_at": TypeDefinition.created_at,
}
DEFAULT_ORDER = (TypeDefinition.browse_name.asc(),)


class TypeDefinitionCrud(CrudBase[TypeDefinition]):
    """`opcua_types` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(TypeDefinition)

    async def get_by_identifier(
        self, session: AsyncSession, *, instance_id: uuid.UUID, identifier: str
    ) -> TypeDefinition | None:
        """按实例内的标识取类型。

        Args: session, instance_id, identifier。
        """
        result = await session.execute(
            select(TypeDefinition).where(
                TypeDefinition.instance_id == instance_id,
                TypeDefinition.identifier == identifier,
            )
        )
        return result.scalars().one_or_none()

    async def list_of_instance(
        self, session: AsyncSession, instance_id: uuid.UUID
    ) -> list[TypeDefinition]:
        """取某实例的全部类型。

        ⚠ 类型必须先于节点建出来：节点引用类型，反过来建会拿不到父类型。
        故这里按创建顺序返回，调用方按序注册。

        Args: session, instance_id。
        """
        result = await session.execute(
            select(TypeDefinition)
            .where(TypeDefinition.instance_id == instance_id)
            .order_by(TypeDefinition.created_at.asc())
        )
        return list(result.scalars().all())

    @staticmethod
    def build_query(
        *, instance_id: uuid.UUID, kind: str | None
    ) -> Select[tuple[TypeDefinition]]:
        """按实例与类型种类构造列表查询。

        Args: instance_id, kind。
        """
        statement = select(TypeDefinition).where(
            TypeDefinition.instance_id == instance_id
        )
        if kind:
            statement = statement.where(
                func.lower(TypeDefinition.kind) == kind.lower()
            )
        return statement


type_definition_crud = TypeDefinitionCrud()
