"""数据库装配件。命名/类型/事务口径见 docs/agents/database-standard.md。"""

from lib.db.base import NAMING_CONVENTION, make_declarative_base
from lib.db.crud import CrudBase
from lib.db.engine import Database, PoolProfile
from lib.db.mixins import TimestampMixin, UuidPrimaryKeyMixin
from lib.db.readonly_source import (
    ReadOnlySqlSource,
    SourceProfile,
    quote_identifier,
)

__all__ = [
    "NAMING_CONVENTION",
    "CrudBase",
    "Database",
    "PoolProfile",
    "ReadOnlySqlSource",
    "SourceProfile",
    "TimestampMixin",
    "UuidPrimaryKeyMixin",
    "make_declarative_base",
    "quote_identifier",
]
