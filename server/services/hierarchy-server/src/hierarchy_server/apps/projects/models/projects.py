"""层级图项目及不可变版本，写属主为 hierarchy。"""

from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from hierarchy_server.settings import DB_SCHEMA
from lib.db.base import make_declarative_base
from lib.db.mixins import TimestampMixin, UuidPrimaryKeyMixin

Base = make_declarative_base(DB_SCHEMA)


class Project(UuidPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "hierarchy_projects"
    __table_args__ = (
        CheckConstraint("revision > 0", name="revision_positive"),
    )
    owner_id: Mapped[UUID] = mapped_column(index=True)
    title: Mapped[str] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer)
    node_count: Mapped[int] = mapped_column(Integer)
    document: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    creation_hash: Mapped[str] = mapped_column(Text)


class Version(UuidPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "hierarchy_versions"
    __table_args__ = (UniqueConstraint("project_id", "revision"),)
    project_id: Mapped[UUID] = mapped_column(
        ForeignKey("hierarchy.hierarchy_projects.id", ondelete="CASCADE"),
        index=True,
    )
    revision: Mapped[int] = mapped_column(Integer)
    document: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
