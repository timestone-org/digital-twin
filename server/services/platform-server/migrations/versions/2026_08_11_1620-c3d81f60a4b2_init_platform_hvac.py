"""建 platform schema 的初始结构：车间、房间、空调。

schema 由 env.py 在迁移前 CREATE IF NOT EXISTS。三张表都是新建，索引随建表
一起下，不需要 CONCURRENTLY——那条规矩管的是给存量表加索引。

Revision ID: c3d81f60a4b2
Revises:
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "c3d81f60a4b2"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_workshops()
    _create_rooms()
    _create_ac_units()


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("hvac_ac_units", schema="platform")
    op.drop_table("hvac_rooms", schema="platform")
    op.drop_table("hvac_workshops", schema="platform")


def _timestamps() -> tuple[sa.Column[datetime], sa.Column[datetime]]:
    """两列建表时刻。时刻一律 timestamptz 存 UTC。"""
    return (
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def _create_workshops() -> None:
    op.create_table(
        "hvac_workshops",
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "length(name) > 0", name=op.f("ck_hvac_workshops_name_nonempty")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hvac_workshops")),
        sa.UniqueConstraint("name", name="uq_hvac_workshops_name"),
        schema="platform",
    )


def _create_rooms() -> None:
    op.create_table(
        "hvac_rooms",
        sa.Column("workshop_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "length(name) > 0", name=op.f("ck_hvac_rooms_name_nonempty")
        ),
        sa.ForeignKeyConstraint(
            ["workshop_id"],
            ["platform.hvac_workshops.id"],
            name=op.f("fk_hvac_rooms_workshop_id"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hvac_rooms")),
        sa.UniqueConstraint(
            "workshop_id", "name", name="uq_hvac_rooms_workshop_id_name"
        ),
        schema="platform",
    )
    op.create_index(
        "ix_hvac_rooms_workshop_id",
        "hvac_rooms",
        ["workshop_id"],
        unique=False,
        schema="platform",
    )


def _create_ac_units() -> None:
    op.create_table(
        "hvac_ac_units",
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("serial", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "length(name) > 0", name=op.f("ck_hvac_ac_units_name_nonempty")
        ),
        sa.CheckConstraint(
            "length(serial) > 0",
            name=op.f("ck_hvac_ac_units_serial_nonempty"),
        ),
        sa.ForeignKeyConstraint(
            ["room_id"],
            ["platform.hvac_rooms.id"],
            name=op.f("fk_hvac_ac_units_room_id"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hvac_ac_units")),
        sa.UniqueConstraint("serial", name="uq_hvac_ac_units_serial"),
        schema="platform",
    )
    op.create_index(
        "ix_hvac_ac_units_room_id",
        "hvac_ac_units",
        ["room_id"],
        unique=False,
        schema="platform",
    )
