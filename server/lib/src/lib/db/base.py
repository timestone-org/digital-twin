"""ORM 声明基类与命名约定。

约束与索引名由 `naming_convention` 自动成立，不靠每个人记得写 `name=`——
名字随机会让将来的迁移无法可靠引用它。
"""

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

NAMING_CONVENTION: dict[str, str] = {
    "pk": "pk_%(table_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
}


def make_declarative_base(schema: str) -> type[DeclarativeBase]:
    """造一个绑定到指定 schema 的声明基类。

    Args: schema（属主服务独占，见 ADR-0003）。
    """

    class Base(DeclarativeBase):
        metadata = MetaData(schema=schema, naming_convention=NAMING_CONVENTION)

    return Base
