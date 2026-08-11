"""锁住 ORM 声明基类与列混入：约束命名、schema 归属、时刻带时区。

⚠ 约束名一旦随机，将来的迁移就无法可靠地 `drop_constraint` 它，
而不同环境生成的名字可能不同——同一份迁移会「测试环境能跑、生产跑不了」。
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import (
    NAMING_CONVENTION,
    TimestampMixin,
    UuidPrimaryKeyMixin,
    make_declarative_base,
)

Base = make_declarative_base("sample")


class Widget(Base, UuidPrimaryKeyMixin, TimestampMixin):  # type: ignore[misc]  # 声明基类由工厂动态造出，pyright 看不到它是类
    __tablename__ = "sample_widgets"
    __table_args__ = (
        UniqueConstraint("code", name=None),
        CheckConstraint("length(code) > 0", name="code_nonempty"),
        Index(None, "code"),
    )

    code: Mapped[str] = mapped_column(String(32), nullable=False)


def test_declarative_base_binds_every_table_to_its_own_schema() -> None:
    assert Widget.__table__.schema == "sample"


def test_naming_convention_covers_all_five_constraint_kinds() -> None:
    assert set(NAMING_CONVENTION) == {"pk", "fk", "uq", "ck", "ix"}


def test_primary_key_is_named_after_the_table() -> None:
    assert Widget.__table__.primary_key.name == "pk_sample_widgets"


def test_unique_and_check_constraints_get_deterministic_names() -> None:
    names = {constraint.name for constraint in Widget.__table__.constraints}
    assert "uq_sample_widgets_code" in names
    assert "ck_sample_widgets_code_nonempty" in names


def test_indexes_get_deterministic_names() -> None:
    assert {index.name for index in Widget.__table__.indexes} == {
        "ix_sample_widgets_code"
    }


def test_primary_key_column_is_a_uuid_defaulting_to_uuid7() -> None:
    column = Widget.__table__.c["id"]
    assert column.primary_key
    assert column.default is not None
    generated = column.default.arg(None)  # type: ignore[union-attr]  # ColumnDefault.arg 是可调用，SQLAlchemy 的标注给的是联合类型
    assert isinstance(generated, uuid.UUID)
    assert generated.version == 7


def test_timestamps_are_timestamptz_and_never_null() -> None:
    for name in ("created_at", "updated_at"):
        column = Widget.__table__.c[name]
        assert isinstance(column.type, DateTime)
        assert column.type.timezone is True
        assert column.nullable is False
        assert column.server_default is not None


def test_updated_at_has_an_onupdate_so_the_orm_maintains_it() -> None:
    assert Widget.__table__.c["updated_at"].onupdate is not None


def test_eager_defaults_is_on_so_flush_does_not_leave_them_expired() -> None:
    # ⚠ 关掉它的话，flush 之后同步访问 created_at 会触发惰性加载，
    # 在 asyncio 会话里那是 MissingGreenlet，且只在改过这行的路径上才炸
    assert Widget.__mapper__.eager_defaults is True


def test_mapped_columns_are_typed_as_declared() -> None:
    assert Widget.__annotations__ == {"code": Mapped[str]}
    assert UuidPrimaryKeyMixin.__annotations__["id"] == Mapped[uuid.UUID]
    assert TimestampMixin.__annotations__["created_at"] == Mapped[datetime]
