"""采集数据源增加只读 Modbus TCP 协议。

Revision ID: a91e5c72d604
Revises: f82d7b39c510
"""

from collections.abc import Sequence

from alembic import op

revision: str = "a91e5c72d604"
down_revision: str | None = "f82d7b39c510"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_constraint(
        "ck_collect_sources_protocol_known",
        "collect_sources",
        schema="platform",
        type_="check",
    )
    op.execute(
        "ALTER TABLE platform.collect_sources "
        "ADD CONSTRAINT ck_collect_sources_protocol_known "
        "CHECK (protocol IN ('modbus_tcp', 'opcua')) NOT VALID"
    )
    op.execute(
        "ALTER TABLE platform.collect_sources "
        "VALIDATE CONSTRAINT ck_collect_sources_protocol_known"
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_constraint(
        "ck_collect_sources_protocol_known",
        "collect_sources",
        schema="platform",
        type_="check",
    )
    op.execute(
        "ALTER TABLE platform.collect_sources "
        "ADD CONSTRAINT ck_collect_sources_protocol_known "
        "CHECK (protocol IN ('opcua')) NOT VALID"
    )
    op.execute(
        "ALTER TABLE platform.collect_sources "
        "VALIDATE CONSTRAINT ck_collect_sources_protocol_known"
    )
